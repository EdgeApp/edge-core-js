import { LocalStorageFolder } from './localStorageFolder.js'
import { AuthServer } from './authServer.js'
import { LoginStore } from './loginStore.js'

/**
 * Constructs an object containing the io resources used in this library,
 * along with the wrappers and caches needed to make use of them.
 */
export class IoContext {
  constructor (nativeIo, opts = {}) {
    // Copy native io resources:
    const keys = ['console', 'fetch', 'localStorage', 'random']
    keys.forEach(key => {
      this[key] = nativeIo[key]
    })

    // Verify that we have what we need:
    keys.forEach(key => {
      if (this[key] == null) {
        throw new Error(`Could not find "${key}" in the environment`)
      }
    })

    // Set up wrapper objects:
    this.authServer = new AuthServer(this, opts.apiKey, opts.authServer)
    this.folder = new LocalStorageFolder(this.localStorage, 'airbitz')
    this.log = this.console
    this.loginStore = new LoginStore(this)
  }

  authRequest (...rest) {
    return this.authServer.request(...rest)
  }
}
