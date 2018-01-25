// @flow
import type { AbcRawIo } from 'airbitz-core-types'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo (): AbcRawIo {
  const out = {}

  if (typeof console !== 'undefined') {
    out.console = console
  }

  if (typeof window !== 'undefined') {
    out.fetch = (...rest) => window.fetch(...rest)
    out.localStorage = window.localStorage

    if (window.crypto != null && window.crypto.getRandomValues != null) {
      out.random = size => {
        const out = new Uint8Array(size)
        window.crypto.getRandomValues(out)
        return out
      }
    }
  }

  return out
}
