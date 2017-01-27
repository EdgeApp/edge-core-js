import {IoContext} from '../io.js'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo (opts = {}) {
  const native = {}

  if (typeof console !== 'undefined') {
    native.console = console
  }

  if (typeof window !== 'undefined') {
    native.fetch = (...rest) => window.fetch(...rest)
    native.localStorage = window.localStorage

    if (window.crypto != null && window.crypto.getRandomValues != null) {
      native.random = (size) => {
        const out = new Uint8Array(size)
        window.crypto.getRandomValues(out)
        return out
      }
    }
  }

  return new IoContext(native, opts)
}
