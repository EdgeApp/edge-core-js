import { makeLocalStorageDisklet } from 'disklet'

import { EdgeFetchOptions, EdgeFetchResponse, EdgeIo } from '../../types/types'
import { scrypt } from '../../util/crypto/scrypt'
import { fetchCorsProxy } from './fetch-cors-proxy'

// Only try CORS proxy/bridge techniques up to 5 times
const MAX_CORS_FAILURE_COUNT = 5

// A map of domains that failed CORS and succeeded via the CORS proxy server
const hostnameProxyWhitelist = new Set<string>()

// A map of domains that failed all CORS techniques and should not re-attempt CORS techniques
const hostnameCorsProxyBlacklist = new Map<string, number>()

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo(): EdgeIo {
  if (typeof window === 'undefined') {
    throw new Error('No `window` object')
  }
  if (window.crypto == null || window.crypto.getRandomValues == null) {
    throw new Error('No secure random number generator in this browser')
  }

  return {
    // Crypto:
    random: size => {
      const out = new Uint8Array(size)
      window.crypto.getRandomValues(out)
      return out
    },
    scrypt,

    // Local io:
    disklet: makeLocalStorageDisklet(window.localStorage, {
      prefix: 'airbitz'
    }),

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions): Promise<EdgeFetchResponse> {
      return window.fetch(uri, opts)
    },
    async fetchCors(
      uri: string,
      opts?: EdgeFetchOptions
    ): Promise<EdgeFetchResponse> {
      const { hostname } = new URL(uri)
      const corsFailureCount = hostnameCorsProxyBlacklist.get(hostname) ?? 0

      let doFetch = true
      const doFetchCors = true

      if (
        corsFailureCount < MAX_CORS_FAILURE_COUNT &&
        hostnameProxyWhitelist.has(hostname)
      ) {
        // Proactively use fetchCorsProxy for any hostnames added to whitelist:
        doFetch = false
      }

      let errorToThrow
      if (doFetch) {
        try {
          // Attempt regular fetch:
          return await window.fetch(uri, opts)
        } catch (error: unknown) {
          // If we exhaust attempts to use CORS-safe fetch, then throw the error:
          if (corsFailureCount >= MAX_CORS_FAILURE_COUNT) {
            throw error
          }
          errorToThrow = error
        }
      }

      if (doFetchCors) {
        try {
          const response = await fetchCorsProxy(uri, opts)
          hostnameProxyWhitelist.add(hostname)
          return response
        } catch (error: unknown) {
          if (errorToThrow == null) errorToThrow = error
        }
      }

      // We failed all CORS techniques, so track attempts
      hostnameCorsProxyBlacklist.set(hostname, corsFailureCount + 1)

      // Throw the error from the first fetch instead of the one from
      // proxy server.
      throw errorToThrow
    }
  }
}
