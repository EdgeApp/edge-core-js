import {AuthServer} from './authServer.js'
import {Log} from './log.js'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo () {
  const out = {}

  if (typeof console !== 'undefined') {
    out.console = console
  }

  if (typeof window !== 'undefined') {
    out.fetch = (...rest) => window.fetch(...rest)
    out.localStorage = window.localStorage

    if ('crypto' in window && 'getRandomValues' in window.crypto) {
      out.random = (size) => {
        const out = new Uint8Array(size)
        window.crypto.getRandomValues(out)
        return out
      }
    }
  }

  return out
}

/**
 * Constructs an object containing the io resources used in this library,
 * along with the wrappers and caches needed to make use of them.
 */
export class IoContext {
  constructor (nativeIo, opts = {}) {
    // Copy native io resources:
    const keys = ['console', 'fetch', 'localStorage', 'random']
    keys.forEach(key => {
      if (key in opts) {
        this[key] = opts[key]
      } else if (nativeIo[key] != null) {
        this[key] = nativeIo[key]
      } else {
        throw new Error(`Could not find "${key}" in the environment`)
      }
    })

    // Set up wrapper objects:
    this.authServer = new AuthServer(this, opts.apiKey)
    this.log = new Log(this)
  }

  authRequest (...rest) {
    return this.authServer.request(...rest)
  }
}
