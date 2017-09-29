// @flow
import type { AbcContextOptions, AbcCorePlugin } from 'airbitz-core-types'
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
export interface CoreRoot {
  // Context options:
  apiKey: string,
  appId: string,
  authServer: string,
  io: FixedIo,
  onError(e: Error): void,
  plugins: Array<AbcCorePlugin>,

  // Loose objects:
  loginStore: any,

  // Redux state:
  redux: Store<RootState, any, any>,

  // Pixies:
  output: RootOutput,
  destroyPixie?: () => void
}

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export function makeCoreRoot (opts: AbcContextOptions) {
  const onErrorDefault = (error, name) => fixedIo.console.error(name, error)

  const {
    apiKey = '!invalid',
    authServer = 'https://auth.airbitz.co/api',
    callbacks = {},
    io = makeBrowserIo(),
    plugins = []
  } = opts
  const { onError = onErrorDefault } = callbacks

  const appId =
    opts.appId != null
      ? opts.appId
      : typeof opts.accountType === 'string'
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''

  const fixedIo = fixIo(io)

  const coreRoot: CoreRoot = {
    apiKey,
    appId,
    authServer,
    io: fixedIo,
    onError,
    plugins,
    loginStore: new LoginStore(fixedIo),
    redux: makeStore(),
    output: ({}: any)
  }
  coreRoot.redux.dispatch(initStore(fixedIo, onError))

  return coreRoot
}

/**
 * Attaches pixies to the core root, begining all background work.
 */
export function startCoreRoot (coreRoot: CoreRoot) {
  coreRoot.destroyPixie = attachPixie(
    coreRoot.redux,
    filterPixie(rootPixie, (props): RootProps => ({
      ...props,
      coreRoot,
      io: coreRoot.io,
      onError: coreRoot.onError,
      plugins: coreRoot.plugins,
      output: (props: any).output
    })),
    e => console.error(e),
    output => (coreRoot.output = output)
  )
  allDestroyPixies.push(coreRoot.destroyPixie)

  return coreRoot
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
