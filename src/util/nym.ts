import {
  createMixFetch,
  disconnectMixFetch,
  IMixFetch,
  IMixFetchFn,
  SetupMixFetchOps
} from '@nymproject/mix-fetch'

import { EdgeFetchOptions, EdgeFetchResponse, EdgeLog } from '../types/types'

/**
 * Configuration options for the NYM mixFetch client.
 */
export const mixFetchOptions: SetupMixFetchOps = {
  clientId: 'edge-core-js-2026-03-10',
  preferredGateway: '5rXcNe2a44vXisK3uqLHCzpzvEwcnsijDMU7hg4fcYk8', // with WSS
  preferredNetworkRequester:
    '5x6q9UfVHs5AohKMUqeivj7a556kVVy7QwoKige8xHxh.6CFoB3kJaDbYz6oafPJxNxNjzahpT2NtgtytcSyN9EvF@5rXcNe2a44vXisK3uqLHCzpzvEwcnsijDMU7hg4fcYk8',
  forceTls: true, // force WSS
  mixFetchOverride: {
    // A healthy mixnet request measures 2-4 seconds. The previous 300000 (5
    // minutes) meant any request the mixnet never answered held its caller for
    // five minutes, which on the send screen reads as a permanently stuck
    // "Calculating Fee" spinner rather than an error.
    requestTimeoutMs: 60000
  }
}

/**
 * Ceilings on how many requests are in the mixnet at once.
 *
 * mix-fetch v1 historically served one request per host at a time, which this
 * module used to work around with a per-host queue. That queue was removed in
 * 5916d9d2 on the understanding that 1.4.2 had fixed the limitation. Measured
 * on an Android emulator, a single Avalanche wallet still opens 12 concurrent
 * requests during one sync, and a wallet list the size of a real user's
 * multiplies that. Bounding it keeps the tunnel inside a regime we have
 * actually observed working, at a negligible cost given each request already
 * takes seconds.
 */
const MAX_IN_FLIGHT_TOTAL = 6
const MAX_IN_FLIGHT_PER_HOST = 2

/**
 * How long a request will wait for a slot before going anyway.
 *
 * The ceilings above are smoothing, not an invariant worth stalling on. If
 * every slot is held by a request that will not answer, an unbounded queue
 * would add its own multi-minute delay on top of the per-request timeout and
 * recreate exactly the stuck "Calculating Fee" this change exists to prevent.
 * Past this deadline the request proceeds and the log says it did.
 */
const MAX_QUEUE_WAIT_MS = 10000

/**
 * Budget for `createMixFetch` itself (client start + gateway handshake).
 *
 * A healthy setup with the pinned gateway completes in under 10s measured.
 * Without a bound here the whole app blocks on the first mixnet request for
 * as long as a dead gateway keeps us waiting, which reads to the user as a
 * freeze.
 */
const SETUP_TIMEOUT_MS = 60000

// MixFetch initialization state
let mixFetchInitPromise: Promise<IMixFetch> | null = null

// Number of mixnet requests currently awaiting a response. Reported on every
// request line, since a request that never settles is only visible as a count
// that never comes back down.
let inFlightCount = 0

// Distinguishes concurrent requests to the same host in the log.
let requestCounter = 0

// Requests waiting on a concurrency slot, oldest first.
const waiting: Array<() => void> = []

// In-flight count per host key, for the per-host ceiling.
const hostInFlight = new Map<string, number>()

/**
 * The `host:port` a request will actually open, used to key the per-host
 * ceiling. Falls back to the raw uri so an unparsable one still gets queued
 * rather than bypassing the limit.
 */
function getHostKey(uri: string): string {
  try {
    const url = new URL(uri)
    const port =
      url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
    return `${url.hostname}:${port}`
  } catch (error: unknown) {
    return uri
  }
}

function hasSlot(hostKey: string): boolean {
  return (
    inFlightCount < MAX_IN_FLIGHT_TOTAL &&
    (hostInFlight.get(hostKey) ?? 0) < MAX_IN_FLIGHT_PER_HOST
  )
}

/**
 * Wait until this request is allowed into the mixnet, then reserve its slot.
 *
 * Returns true when the slot was granted by the ceilings, false when the
 * deadline elapsed first and the request is proceeding regardless. The slot is
 * reserved either way, so the counters stay honest.
 */
async function acquireSlot(hostKey: string): Promise<boolean> {
  const deadline = Date.now() + MAX_QUEUE_WAIT_MS
  let granted = true

  while (!hasSlot(hostKey)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      granted = false
      break
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let wake: () => void = () => {}
    await new Promise<void>(resolve => {
      wake = resolve
      waiting.push(resolve)
      timer = setTimeout(resolve, remaining)
    })
    clearTimeout(timer)
    // Drop our own resolver. `releaseSlot` drains the whole array, so this
    // only matters when the deadline fired instead: without it, a stretch
    // where nothing settles (exactly the case being diagnosed) would grow
    // `waiting` without bound, since nothing else ever clears it.
    const index = waiting.indexOf(wake)
    if (index !== -1) waiting.splice(index, 1)
  }

  inFlightCount += 1
  hostInFlight.set(hostKey, (hostInFlight.get(hostKey) ?? 0) + 1)
  return granted
}

/**
 * Release this request's slot and wake everyone waiting.
 *
 * Every waiter re-checks its own host ceiling in `acquireSlot`, so waking all
 * of them is correct: the ones still blocked simply queue again. Waking only
 * the head would stall the queue whenever the head is blocked on a busy host
 * while a slot for some other host just came free.
 */
function releaseSlot(hostKey: string): void {
  inFlightCount -= 1
  const remaining = (hostInFlight.get(hostKey) ?? 1) - 1
  if (remaining <= 0) hostInFlight.delete(hostKey)
  else hostInFlight.set(hostKey, remaining)

  const woken = waiting.splice(0, waiting.length)
  for (const wake of woken) wake()
}

/**
 * A path segment long enough to be an identifier rather than a route: an
 * address, a txid, a public key, or an API key.
 *
 * Length is what separates the two, not character set. Route segments in the
 * endpoints we call are short (`ext`, `bc`, `C`, `rpc`, `v2`, `api`, the
 * 16-character `get_address_info`), while identifiers run 26 characters and up.
 * The separator classes matter: hyphens for UUIDs, a colon for cashaddr-style
 * `prefix:address`, underscores and dots for the rest.
 */
const IDENTIFIER_SEGMENT = /^[0-9a-zA-Z][0-9a-zA-Z._:-]{19,}$/

/**
 * Reduce a request URI to the part that is safe to write to a user's log.
 *
 * Query strings are dropped entirely because RPC endpoints carry API keys
 * there. The path is kept, because two endpoints on one host are often
 * different routes and telling them apart is the point of this logging, but
 * any segment that looks like an identifier is masked: several chains put a
 * wallet address or txid directly in the path, and these lines end up in
 * user-uploaded support logs.
 */
function describeUri(uri: string): string {
  try {
    const { host, pathname } = new URL(uri)
    if (pathname === '/') return host
    const safePath = pathname
      .split('/')
      .map(segment =>
        IDENTIFIER_SEGMENT.test(segment) ? '<redacted>' : segment
      )
      .join('/')
    return `${host}${safePath}`
  } catch (error: unknown) {
    return '<unparsable uri>'
  }
}

/**
 * Reduce any URL embedded in free text the same way `describeUri` reduces the
 * request target.
 *
 * Error messages from the fetch and Go layers routinely quote the whole
 * request URL (`Post "https://host/tx/<txid>?apikey=...": context deadline
 * exceeded`). Running them through the same reducer keeps one rule for what
 * may reach a support log, so an identifier masked in the request label cannot
 * reappear intact in the error text on the very same line.
 */
function redactUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, url => {
    // Trailing punctuation belongs to the sentence, not the URL.
    const trimmed = url.replace(/[.,:;!?)\]}]+$/, '')
    return describeUri(trimmed) + url.slice(trimmed.length)
  })
}

/**
 * Render an error for the log, preferring the raw message.
 *
 * The mix-fetch v1 Go layer surfaces failures as opaque strings such as
 * `panic:todo: extract error message`, where the real reason is discarded
 * inside the library. Keeping the message verbatim is what makes those
 * reports attributable to a specific host, so the text is preserved apart
 * from query strings, which are the part that carries credentials.
 */
function describeError(error: unknown): string {
  const text =
    error instanceof Error
      ? error.name === 'Error'
        ? error.message
        : `${error.name}: ${error.message}`
      : String(error)
  return redactUrlsInText(text)
}

/**
 * Initialize the NYM mixFetch client. Must be called before using mixFetch.
 * Safe to call multiple times - subsequent calls return the same promise.
 */
export async function initMixFetch(log: EdgeLog): Promise<IMixFetchFn> {
  if (mixFetchInitPromise == null) {
    log.warn('Initializing mixFetch...')
    const setupStart = Date.now()
    const pending = createMixFetch(mixFetchOptions)
    // The timeout below can abandon this setup while it is still in flight.
    // Deliberately do NOT tear it down on late completion: `createMixFetch`
    // resolves to a healthy global singleton, and disconnecting it (a
    // process-wide operation) would race a newer init that has taken over.
    // A late completion just repopulates `__mixFetchGlobal`, which the next
    // init reuses. Swallow a late rejection so it is not unhandled.
    pending.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(`mixFetch setup timed out after ${SETUP_TIMEOUT_MS}ms`)
        )
      }, SETUP_TIMEOUT_MS)
    })
    mixFetchInitPromise = Promise.race([pending, timeout])
      .then(mixFetchModule => {
        log.warn(
          `mixFetch initialized successfully in ${Date.now() - setupStart}ms`
        )
        return mixFetchModule
      })
      .catch(async error => {
        // Clean up stale global state left by the failed init so the
        // next createMixFetch call starts fresh instead of reusing a
        // broken singleton.
        try {
          await disconnectMixFetch()
        } catch {}
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (window as any).__mixFetchGlobal
        mixFetchInitPromise = null
        log.error(
          `mixFetch initialization failed after ${
            Date.now() - setupStart
          }ms: ${describeError(error)}`
        )
        throw error
      })
      .finally(() => {
        clearTimeout(timer)
      })
  }
  const mixFetchModule = await mixFetchInitPromise
  return mixFetchModule.mixFetch
}

/**
 * Perform a single request over the NYM mixnet, logging its lifecycle.
 *
 * Every request writes a `start` line before it goes out and exactly one
 * terminal line when it settles. A request that produces a `start` with no
 * terminal line is one that never came back, which is the shape we cannot
 * currently attribute to a host, and the reason this instrumentation exists.
 *
 * These go out at `warn` rather than `info` deliberately. The app configures
 * the core with `defaultLogLevel: 'warn'`, so `info` is dropped unless the
 * user has turned on Verbose Logging, and a QA log export would arrive with
 * none of this in it. NYM is opt-in and low volume, so the extra lines only
 * appear for the users whose reports we are trying to diagnose.
 */
export async function nymFetch(
  uri: string,
  opts: EdgeFetchOptions,
  log: EdgeLog
): Promise<EdgeFetchResponse> {
  const mixFetch = await initMixFetch(log)

  const id = ++requestCounter
  const target = describeUri(uri)
  const method = opts.method ?? 'GET'
  const label = `mixFetch #${id} ${method} ${target}`

  const hostKey = getHostKey(uri)
  const queuedAt = Date.now()
  const granted = await acquireSlot(hostKey)
  const queuedMs = Date.now() - queuedAt

  const start = Date.now()
  const queueNote =
    queuedMs === 0
      ? ''
      : granted
      ? `, queued ${queuedMs}ms`
      : `, queued ${queuedMs}ms then went over the limit`
  log.warn(`${label} start (${inFlightCount} in flight${queueNote})`)
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    releaseSlot(hostKey)
  }

  try {
    const response = await mixFetch(
      uri,
      {
        ...opts,
        mode: 'unsafe-ignore-cors' as RequestMode
      },
      mixFetchOptions
    )
    release()
    log.warn(
      `${label} -> ${response.status} in ${
        Date.now() - start
      }ms (${inFlightCount} in flight)`
    )
    return response
  } catch (error: unknown) {
    release()
    log.error(
      `${label} failed after ${
        Date.now() - start
      }ms (${inFlightCount} in flight): ${describeError(error)}`
    )
    throw error
  }
}
