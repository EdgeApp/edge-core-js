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

// MixFetch initialization state
let mixFetchInitPromise: Promise<IMixFetch> | null = null

// Per-host request queue to handle mixFetch's one-request-per-host limitation
// Maps host -> Promise that resolves when current request completes (for chaining)
const hostRequestChains = new Map<string, Promise<Response>>()

/**
 * Extract the host:port from a URI for queue keying
 */
function getHostKey(uri: string): string {
  try {
    const url = new URL(uri)
    const port =
      url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
    return `${url.hostname}:${port}`
  } catch {
    return uri
  }
}

/**
 * Initialize the NYM mixFetch client. Must be called before using mixFetch.
 * Safe to call multiple times - subsequent calls return the same promise.
 */
export async function initMixFetch(log: EdgeLog): Promise<IMixFetchFn> {
  if (mixFetchInitPromise == null) {
    log('Initializing mixFetch...')
    mixFetchInitPromise = createMixFetch(mixFetchOptions)
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
  }
  const mixFetchModule = await mixFetchInitPromise
  return mixFetchModule.mixFetch
}

/**
 * Queue-wrapped mixFetch that serializes requests per host.
 * mixFetch only allows one concurrent request per host, so we chain them.
 */
export async function queueMixFetch(
  uri: string,
  opts: RequestInit & { mode?: string },
  log: EdgeLog
): Promise<Response> {
  const hostKey = getHostKey(uri)

  // Get the current chain for this host (or resolved promise if none)
  const previousChain = hostRequestChains.get(hostKey) ?? Promise.resolve()

  // Chain our request after the previous one
  const ourWork = previousChain
    .catch(() => {}) // Ignore errors from previous request
    .then(async () => {
      const nymMixFetch = await initMixFetch(log)
      return await nymMixFetch(uri, opts, mixFetchOptions)
    })
    .catch(error => {
      log.error(`Error in queueMixFetch for host ${hostKey}:`, error)
      throw error
    })
    .finally(() => {
      // Clean up if we're still the chain tail
      if (hostRequestChains.get(hostKey) === ourWork) {
        hostRequestChains.delete(hostKey)
      }
    })

  // Store our chain BEFORE awaiting - ensures subsequent requests wait for us
  hostRequestChains.set(hostKey, ourWork)

  return await ourWork
}
