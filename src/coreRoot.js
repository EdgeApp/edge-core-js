// @flow
import { AuthServer } from './io/authServer.js'
import { fixIo } from './io/fixIo.js'
import type { FixedIo } from './io/fixIo.js'
import { LoginStore } from './io/loginStore.js'
import { makeBrowserIo } from './io/browser'
import { fetchExchangeRates, initStore, setupPlugins } from './redux/actions.js'
import type { RootState } from './redux/rootReducer.js'
import { makeStore } from './redux/index.js'
import type { AbcContextCallbacks, AbcContextOptions } from 'airbitz-core-types'
import type { Store } from 'redux'

/**
 * The root of the entire core state machine.
 * Contains io resources, context options, Redux store,
 * and tree of background workers. Everything that happens, happens here.
 */
class CoreRootClass {
  io: FixedIo
  onError: $PropertyType<AbcContextCallbacks, 'onError'>

  authServer: any
  loginStore: any
  redux: Store<RootState, {}, any>
  authRequest (method: string, path: string, body?: {}) {
    return this.authServer.request(method, path, body)
  }

  constructor (opts: AbcContextOptions) {
    const onErrorDefault = (error, name) => this.io.console.error(name, error)

    const {
      apiKey,
      authServer = 'https://auth.airbitz.co/api',
      callbacks = {},
      io = makeBrowserIo(),
      plugins = []
    } = opts
    const { onError = onErrorDefault } = callbacks

    // Copy native io resources:
    this.io = fixIo(io)
    this.onError = onError

    // Set up wrapper objects:
    this.authServer = new AuthServer(this.io, apiKey, authServer)
    this.loginStore = new LoginStore(this.io)
    this.redux = makeStore()
    this.redux.dispatch(initStore(this.io, onError))
    this.redux
      .dispatch(setupPlugins(this.io, plugins))
      .then(() => this.redux.dispatch(fetchExchangeRates()))
  }
}

export type CoreRoot = CoreRootClass

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export function makeCoreRoot (opts: AbcContextOptions) {
  return new CoreRootClass(opts)
}
