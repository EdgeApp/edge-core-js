// @flow
import type { AbcContextCallbacks, AbcContextOptions } from 'airbitz-core-types'
import type { Store } from 'redux'
import { attachPixie, filterPixie } from 'redux-pixies'
import { makeBrowserIo } from '../io/browser'
import { fixIo } from '../io/fixIo.js'
import type { FixedIo } from '../io/fixIo.js'
import { initStore } from './actions.js'
import { LoginStore } from './login/loginStore.js'
import { makeStore } from './makeStore.js'
import { rootPixie } from './rootPixie.js'
import type { RootOutput, RootProps } from './rootPixie.js'
import type { RootState } from './rootReducer.js'

let allDestroyPixies: Array<() => void> = []

/**
 * The root of the entire core state machine.
 * Contains io resources, context options, Redux store,
 * and tree of background workers. Everything that happens, happens here.
 */
class CoreRootClass {
  io: FixedIo
  onError: $PropertyType<AbcContextCallbacks, 'onError'>

  apiKey: string
  authServer: string
  loginStore: any

  // Redux state:
  redux: Store<RootState, any, any>
  output: RootOutput
  destroyPixie: () => void

  constructor (opts: AbcContextOptions) {
    const onErrorDefault = (error, name) => this.io.console.error(name, error)

    const {
      apiKey = '!invalid',
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
    this.apiKey = apiKey
    this.authServer = authServer
    this.loginStore = new LoginStore(this.io)

    // Set up redux:
    this.redux = makeStore()
    this.redux.dispatch(initStore(this.io, onError))
    this.destroyPixie = attachPixie(
      this.redux,
      filterPixie(rootPixie, (props): RootProps => ({
        ...props,
        io: this.io,
        onError,
        plugins,
        output: (props: any).output
      })),
      e => console.error(e),
      output => (this.output = output)
    )
    allDestroyPixies.push(this.destroyPixie)
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

/**
 * We use this for unit testing, to kill all core contexts.
 */
export function destroyAllCores () {
  for (const destroyPixie of allDestroyPixies) {
    destroyPixie()
  }
  allDestroyPixies = []
}
