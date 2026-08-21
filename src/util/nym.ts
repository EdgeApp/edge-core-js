import {
  createMixFetch,
  disconnectMixFetch,
  IMixFetch,
  IMixFetchFn,
  SetupMixFetchOps
} from '@nymproject/mix-fetch'

import { EdgeLog } from '../types/types'

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

/**
 * How long to refuse new setups after one fails, and the ceiling that wait
 * doubles up to.
 *
 * Every `createMixFetch` spawns a web worker holding megabytes of WASM before
 * it ever contacts the gateway, and the library exposes no way to terminate
 * that worker, so a failed setup leaves one behind. Retrying on each request
 * therefore costs memory per attempt: with a dead gateway and a poll loop
 * driving requests every few seconds, the workers accumulate until the host
 * kills the whole JS context. On iOS that reads to the user as being logged
 * out, since the core's WebView is what gets killed and reloaded.
 *
 * A cooldown bounds the cost to one worker per window, and the doubling keeps
 * a long outage from spending any meaningful memory at all.
 */
const RETRY_BASE_MS = 30000
const RETRY_MAX_MS = 300000

/**
 * Builds the mixFetch setup routine over its own cooldown state.
 *
 * The returned function initializes the NYM mixFetch client, and must be
 * called before using mixFetch. It is safe to call multiple times: subsequent
 * calls return the same promise.
 *
 * A failed setup starts a cooldown: calls made before it expires fail
 * immediately with the error that started it, instead of building another
 * client.
 *
 * Tests build their own instance over a clock they control, which also gives
 * them fresh state per case.
 *
 * The cooldown state is per instance, but the client, its worker and
 * `window.__mixFetchGlobal` are process-global, so two live instances would
 * each hold a cooldown of their own while spawning workers into the same
 * process. The single instance exported below is the only supported
 * arrangement.
 */
export function makeMixFetchSetup(
  now: () => number = () => Date.now()
): (log: EdgeLog) => Promise<IMixFetchFn> {
  let mixFetchInitPromise: Promise<IMixFetch> | null = null

  /** When a new setup may be attempted, and the wait that produced it. */
  let retryAfter: number = 0
  let retryDelay: number = RETRY_BASE_MS

  /** The failure to re-throw for callers that arrive during the cooldown. */
  let lastError: unknown

  return async function initMixFetch(log: EdgeLog): Promise<IMixFetchFn> {
    if (mixFetchInitPromise == null) {
      if (now() < retryAfter) {
        // Re-throwing `lastError` itself would hand the caller a stack and a
        // message from a setup that ended minutes ago, so a cooldown
        // rejection reads in a crash report as a fresh 60-second timeout. It
        // is also not necessarily an `Error`: the library rejects with a raw
        // `MessageEvent` on a worker error, so `.message` can be undefined
        // downstream.
        //
        // Nothing is logged here. This runs once per refused caller, and the
        // breadcrumb that makes the quiet window visible is emitted once per
        // window where the cooldown is armed.
        const remainingMs = retryAfter - now()
        const error: Error & { cause?: unknown } = new Error(
          `mixFetch setup is cooling down for another ${Math.round(
            remainingMs / 1000
          )}s`
        )
        error.cause = lastError
        throw error
      }

      log('Initializing mixFetch...')
      const pending = createMixFetch(mixFetchOptions)
      // The timeout below can abandon this setup while it is still in flight.
      // `createMixFetch` publishes `window.__mixFetchGlobal` as soon as the
      // worker exists and only then awaits the gateway handshake
      // (`@nymproject/mix-fetch/index.js:446-449`), so the failure path
      // usually deletes a global whose owner is already past that assignment:
      // the abandoned worker stays alive and unreachable, and the next setup
      // builds a fresh one. A delete that lands before the assignment lets the
      // late completion re-publish instead, and the line right after it
      // configures that client, so the next setup finds a working global
      // rather than an unconfigured one. Either way the cost is one worker per
      // cooldown window, against a ceiling of RETRY_MAX_MS. Swallow the late
      // rejection so it is not unhandled.
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
          log('mixFetch initialized successfully')
          return mixFetchModule
        })
        .catch(error => {
          // Arm the cooldown before any cleanup. The timeout fires while the
          // setup is still running, so the disconnect below is an RPC into a
          // worker that is still busy and has no bounded completion; awaiting
          // it would leave `mixFetchInitPromise` pending forever, and every
          // later caller would await that instead of failing fast.
          mixFetchInitPromise = null
          lastError = error
          retryAfter = now() + retryDelay
          log.error(
            `mixFetch initialization failed (no retry for ${Math.round(
              retryDelay / 1000
            )}s):`,
            error
          )
          // One breadcrumb per cooldown window, not one per refused caller.
          // The app caps Sentry at 25 breadcrumbs, so a poll loop retrying
          // every few seconds would evict the whole history in about a
          // minute, blinding the crash report this failure most needs to
          // appear in. Emitted before the doubling below, so it names the
          // window actually armed.
          log.breadcrumb('mixFetch setup failed, cooling down', {
            cooldownMs: retryDelay
          })
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)

          // Best-effort: clear the library's singleton so the next setup starts
          // fresh instead of reusing a broken one. Not awaited, per above.
          disconnectMixFetch().catch(() => {})
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (window as any).__mixFetchGlobal

          throw error
        })
        .finally(() => {
          clearTimeout(timer)
        })
    }
    const mixFetchModule = await mixFetchInitPromise
    return mixFetchModule.mixFetch
  }
}

export const initMixFetch = makeMixFetchSetup()
