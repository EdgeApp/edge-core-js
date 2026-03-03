import {
  createMixFetch,
  IMixFetch,
  SetupMixFetchOps
} from '@nymproject/mix-fetch'

import { EdgeLog } from '../types/types'

/**
 * Configuration options for the NYM mixFetch client.
 */
export const mixFetchOptions: SetupMixFetchOps = {
  forceTls: true, // force WSS
  mixFetchOverride: {
    requestTimeoutMs: 120000
  }
}

// MixFetch initialization state
let mixFetchInitPromise: Promise<IMixFetch> | null = null

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
