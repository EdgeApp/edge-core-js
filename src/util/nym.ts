import {
  createMixFetch,
  disconnectMixFetch,
  IMixFetch,
  IMixFetchFn,
  SetupMixFetchOps
} from '@nymproject/mix-fetch'

import { EdgeLog } from '../types/types'

/**
 * Per-request budget for a NYM mixnet fetch.
 *
 * mix-fetch's own `requestTimeoutMs` (below) is meant to bound each request,
 * but a request whose exit connection stalls (a blocked port, an unresponsive
 * host, a half-open TCP stream) has been observed hanging past it: David Coen's
 * 2026-07-20 staging report showed Coreum/Avalanche sends sitting on
 * "Calculating Fee" indefinitely with NYM on, even after the v1 revert. So we
 * also impose the same budget ourselves in `fetchWithTimeout`, which guarantees
 * the promise rejects on our side and lets an engine fail over to its next
 * server instead of awaiting the request forever.
 */
const REQUEST_TIMEOUT_MS = 300000

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
    requestTimeoutMs: REQUEST_TIMEOUT_MS
  }
}

/**
 * Impose `REQUEST_TIMEOUT_MS` on a single mixFetch call.
 *
 * This bounds how long *we* wait; it cannot cancel the in-flight wasm request,
 * which takes no abort signal. That is enough for the caller: a rejected fetch
 * lets an engine mark the server bad and move to the next one, which is what a
 * working `requestTimeoutMs` would have bought us. Keeps v1's 3-arg
 * `IMixFetchFn` signature so callers are unchanged.
 */
async function fetchWithTimeout(
  mixFetch: IMixFetchFn,
  url: string,
  args: any,
  opts?: SetupMixFetchOps
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`mixFetch request timed out after ${REQUEST_TIMEOUT_MS}ms`)
      )
    }, REQUEST_TIMEOUT_MS)
  })
  const request = mixFetch(url, args, opts)
  // Once the timer wins the race nothing is awaiting `request` any more, so a
  // late rejection would surface as an unhandled rejection in the worker. The
  // caller already has its timeout error and the response is worthless by now,
  // so swallowing it here is the whole handling this needs.
  request.catch(() => {})
  try {
    return await Promise.race([request, timeout])
  } finally {
    clearTimeout(timer)
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

/**
 * Initialize the NYM mixFetch client. Must be called before using mixFetch.
 * Safe to call multiple times - subsequent calls return the same promise.
 */
export async function initMixFetch(log: EdgeLog): Promise<IMixFetchFn> {
  if (mixFetchInitPromise == null) {
    log('Initializing mixFetch...')
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
        log('mixFetch initialized successfully')
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
        log.error('mixFetch initialization failed:', error)
        throw error
      })
      .finally(() => {
        clearTimeout(timer)
      })
  }
  const mixFetchModule = await mixFetchInitPromise
  const { mixFetch } = mixFetchModule
  return async (url, args, opts) =>
    await fetchWithTimeout(mixFetch, url, args, opts)
}
