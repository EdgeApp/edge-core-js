import {
  createMixFetch,
  disconnectMixTunnel,
  SetupMixTunnelOpts
} from '@nymproject/mix-fetch'

import { EdgeLog } from '../types/types'

/** The fetch-bound function `createMixFetch` resolves to. */
type MixFetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Configuration options for the NYM mixFetch tunnel.
 */
export const mixFetchOptions: SetupMixTunnelOpts = {
  clientId: 'edge-core-js-2026-03-10',
  forceTls: true, // force WSS
  // Mixnet round trips are slow, so give the tunnel handshake plenty of time.
  // v1 tuned a 5 min `requestTimeoutMs`; v2 exposes no per-request timeout, but
  // the tunnel setup is where mixnet latency bites, so restore that 5 min
  // budget here to avoid premature failures during the handshake.
  connectTimeoutMs: 300000
}

// MixFetch initialization state
let mixFetchInitPromise: Promise<MixFetchFn> | null = null

/**
 * Initialize the NYM mixFetch client. Must be called before using mixFetch.
 * Safe to call multiple times - subsequent calls return the same promise.
 */
export async function initMixFetch(log: EdgeLog): Promise<MixFetchFn> {
  if (mixFetchInitPromise == null) {
    log('Initializing mixFetch...')
    mixFetchInitPromise = createMixFetch(mixFetchOptions)
      .then(mixFetch => {
        log('mixFetch initialized successfully')
        return mixFetch
      })
      .catch(async error => {
        // Tear down any partially-established tunnel left by the failed init
        // so the next createMixFetch call starts fresh instead of reusing a
        // broken singleton.
        try {
          await disconnectMixTunnel()
        } catch {}
        mixFetchInitPromise = null
        log.error('mixFetch initialization failed:', error)
        throw error
      })
  }
  return await mixFetchInitPromise
}
