import {
  createMixFetch,
  IMixFetch,
  mixFetch,
  SetupMixFetchOps
} from '@nymproject/mix-fetch'

import { EdgeLog } from '../types/types'

/**
 * Configuration options for the NYM mixFetch client.
 */
export const mixFetchOptions: SetupMixFetchOps = {
  preferredGateway: '5rXcNe2a44vXisK3uqLHCzpzvEwcnsijDMU7hg4fcYk8', // with WSS
  preferredNetworkRequester:
    '5x6q9UfVHs5AohKMUqeivj7a556kVVy7QwoKige8xHxh.6CFoB3kJaDbYz6oafPJxNxNjzahpT2NtgtytcSyN9EvF@5rXcNe2a44vXisK3uqLHCzpzvEwcnsijDMU7hg4fcYk8',
  mixFetchOverride: {
    requestTimeoutMs: 60_000
  },
  forceTls: true, // force WSS
  extra: {}
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
export async function initMixFetch(log: EdgeLog): Promise<IMixFetch> {
  // Return existing promise if already initializing or initialized
  if (mixFetchInitPromise == null) {
    log('Initializing mixFetch...')
    mixFetchInitPromise = createMixFetch(mixFetchOptions)
      .then(mixFetch => {
        log('mixFetch initialized successfully')
        return mixFetch
      })
      .catch(error => {
        mixFetchInitPromise = null
        log.error('mixFetch initialization failed:', error)
        throw error
      })
  }
  return await mixFetchInitPromise
}

/**
 * Queue-wrapped mixFetch that serializes requests per host.
 * mixFetch only allows one concurrent request per host, so we chain them.
 */
export async function queueMixFetch(
  uri: string,
  opts: RequestInit & { mode?: string }
): Promise<Response> {
  const hostKey = getHostKey(uri)

  // Get the current chain for this host (or resolved promise if none)
  const previousChain = hostRequestChains.get(hostKey) ?? Promise.resolve()

  // Chain our request after the previous one
  const ourWork = previousChain
    .catch(() => {}) // Ignore errors from previous request
    .then(async () => await mixFetch(uri, opts, mixFetchOptions))
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
