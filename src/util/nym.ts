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
  return mixFetchModule.mixFetch
}
