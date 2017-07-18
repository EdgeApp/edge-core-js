import { scrypt } from '../crypto/scrypt.js'
import { makeStore } from '../redux/index.js'
import {
  fetchExchangeRates,
  initStore,
  setupPlugins
} from '../redux/actions.js'
import { AuthServer } from './authServer.js'
import { LoginStore } from './loginStore.js'
import { makeLocalStorageFolder } from 'disklet'

/**
 * Checks the properties of an `io` object,
 * upgrading obsolete ones and verifying that we have all necessary ones.
 */
export function fixIo (io) {
  const out = {}

  // Copy native io resources:
  const keys = ['console', 'fetch', 'folder', 'random', 'scrypt']
  for (const key of keys) {
    out[key] = io[key]
  }

  // If there is no native folder, try `localStorage` instead:
  if (out.folder == null && io.localStorage != null) {
    out.folder = makeLocalStorageFolder(io.localStorage, {
      prefix: 'airbitz'
    })
  }

  // If there is no scrypt, use the JS one:
  if (out.scrypt == null) {
    out.scrypt = scrypt
  }

  // Verify that we have what we need:
  for (const key of keys) {
    if (out[key] == null) {
      throw new Error(`Could not find "${key}" in the environment`)
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
    const onErrorDefault = (error, name) => this.console.error(name, error)

    const {
      apiKey,
      authServer = 'https://auth.airbitz.co/api',
      callbacks = {},
      plugins = []
    } = opts
    const { onError = onErrorDefault } = callbacks

    // Copy native io resources:
    const fixedIo = fixIo(nativeIo)
    Object.assign(this, fixedIo)

    // Set up wrapper objects:
    this.onError = onError
    this.authServer = new AuthServer(this, apiKey, authServer)
    this.loginStore = new LoginStore(this)
    this.redux = makeStore()
    this.redux.dispatch(initStore(fixedIo, onError))
    this.redux
      .dispatch(setupPlugins(fixedIo, plugins))
      .then(() => this.redux.dispatch(fetchExchangeRates()))
  }

  authRequest (...rest) {
    return this.authServer.request(...rest)
  }
}
