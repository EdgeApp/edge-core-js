import {AuthServer} from './authServer.js'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo () {
  const out = {}

  if (typeof window !== 'undefined') {
    out.fetch = window.fetch
    out.localStorage = window.localStorage
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
    const keys = ['fetch', 'localStorage']
    for (const key of keys) {
      if (key in opts) {
        this[key] = opts[key]
      } else if (nativeIo[key]) {
        this[key] = nativeIo[key]
      } else {
        throw new Error(`Could not find "${key}" in the environment`)
      }
    }

    // Set up wrapper objects:
    this.authServer = new AuthServer(this, opts.apiKey)
  }

  authRequest () {
    return this.authServer.request.apply(this.authServer, arguments)
  }
}
