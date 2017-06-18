import { AuthServer } from './authServer.js'
import { LoginStore } from './loginStore.js'
import { makeRedux } from './redux.js'
import { makeLocalStorageFolder } from 'disklet'

/**
 * Constructs an object containing the io resources used in this library,
 * along with the wrappers and caches needed to make use of them.
 */
export class IoContext {
  constructor (nativeIo, opts = {}) {
    const onErrorDefault = (error, name) => this.console.error(name, error)

    const {
      apiKey,
      authServer = 'https://auth.airbitz.co/api',
      callbacks = {}
    } = opts
    const { onError = onErrorDefault } = callbacks

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
    this.onError = onError
    this.authServer = new AuthServer(this, apiKey, authServer)
    this.loginStore = new LoginStore(this)
    this.redux = makeRedux(onError)
  }

  authRequest (...rest) {
    return this.authServer.request(...rest)
  }
}
