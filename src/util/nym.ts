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
    requestTimeoutMs: 300000
  }
}

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

/**
 * A path segment that is long and unbroken enough to be an identifier rather
 * than a route: an address, a txid, a public key, or an API key. Real route
 * segments in the endpoints we call (`ext`, `bc`, `C`, `rpc`, `v2`, `api`,
 * `get_address_info`) are short, or contain separators, or both.
 */
const IDENTIFIER_SEGMENT = /^(0x)?[0-9a-zA-Z]{20,}$/

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
 * Render an error for the log, preferring the raw message.
 *
 * The mix-fetch v1 Go layer surfaces failures as opaque strings such as
 * `panic:todo: extract error message`, where the real reason is discarded
 * inside the library. Keeping the message verbatim is what makes those
 * reports attributable to a specific host.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'Error'
      ? error.message
      : `${error.name}: ${error.message}`
  }
  return String(error)
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

  const start = Date.now()
  log.warn(`${label} start (${++inFlightCount} in flight)`)
  try {
    const response = await mixFetch(
      uri,
      {
        ...opts,
        mode: 'unsafe-ignore-cors' as RequestMode
      },
      mixFetchOptions
    )
    log.warn(
      `${label} -> ${response.status} in ${
        Date.now() - start
      }ms (${--inFlightCount} in flight)`
    )
    return response
  } catch (error: unknown) {
    log.error(
      `${label} failed after ${
        Date.now() - start
      }ms (${--inFlightCount} in flight): ${describeError(error)}`
    )
    throw error
  }
}
