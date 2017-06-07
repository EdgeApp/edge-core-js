import { AuthServer } from './authServer.js'
import { LoginStore } from './loginStore.js'
import { makeLocalStorageFolder } from 'disklet'

/**
 * Constructs an object containing the io resources used in this library,
 * along with the wrappers and caches needed to make use of them.
 */
export class IoContext {
  constructor (nativeIo, opts = {}) {
    // Copy native io resources:
    const keys = ['console', 'fetch', 'folder', 'random']
    for (const key of keys) {
      this[key] = nativeIo[key]
    }

    // If there is no native folder, try `localStorage` instead:
    if (this.folder == null && nativeIo.localStorage != null) {
      this.folder = makeLocalStorageFolder(nativeIo.localStorage, {
        prefix: 'airbitz'
      })
    }

    // Verify that we have what we need:
    for (const key of keys) {
      if (this[key] == null) {
        throw new Error(`Could not find "${key}" in the environment`)
      }
    }

    // Set up wrapper objects:
    this.authServer = new AuthServer(this, opts.apiKey, opts.authServer)
    this.loginStore = new LoginStore(this)
  }

  authRequest (...rest) {
    return this.authServer.request(...rest)
  }
}
