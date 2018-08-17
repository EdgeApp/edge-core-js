// @flow

import type { Dispatch, Store } from 'redux'
import { attachPixie, filterPixie } from 'redux-pixies'
import type { PixieInput, ReduxProps } from 'redux-pixies'

import type {
  EdgeContextOptions,
  EdgeCorePluginFactory,
  EdgeIo
} from '../edge-core-index.js'
import type { RootAction } from './actions.js'
import { LoginStore } from './login/loginStore.js'
import { makeStore } from './makeStore.js'
import { rootPixie } from './root-pixie.js'
import type { RootOutput } from './root-pixie.js'
import type { RootState } from './root-reducer.js'

let allDestroyPixies: Array<() => void> = []

function nop () {}

/**
 * The root of the entire core state machine.
 * Contains io resources, context options, Redux store,
 * and tree of background workers. Everything that happens, happens here.
 */
export interface CoreRoot {
  // Context options:
  apiKey: string;
  appId: string;
  authServer: string;
  io: EdgeIo;
  onError(e: Error): mixed;
  onExchangeUpdate(): mixed;
  plugins: Array<EdgeCorePluginFactory>;
  shapeshiftKey: string | void;

  // Loose objects:
  loginStore: LoginStore;

  // Redux state:
  redux: Store<RootState, RootAction>;

  // Pixies:
  output: RootOutput;
  destroyPixie?: () => void;
}

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export function makeCoreRoot (io: EdgeIo, opts: EdgeContextOptions) {
  const onErrorDefault = (error, name) => io.console.error(name, error)

  const {
    apiKey = '!invalid',
    authServer = 'https://auth.airbitz.co/api',
    callbacks = {},
    plugins = [],
    shapeshiftKey = void 0
  } = opts
  const { onError = onErrorDefault, onExchangeUpdate = nop } = callbacks

  const appId = opts.appId != null ? opts.appId : ''

  const output: any = {}

  const coreRoot: CoreRoot = {
    apiKey,
    appId,
    authServer,
    io,
    onError,
    onExchangeUpdate,
    plugins,
    shapeshiftKey,
    loginStore: new LoginStore(io),
    redux: makeStore(),
    output
  }
  coreRoot.redux.dispatch({
    type: 'INIT',
    payload: { apiKey, appId, authServer }
  })

  return coreRoot
}

/**
 * Attaches pixies to the core root, beginning all background work.
 */
export function startCoreRoot (coreRoot: CoreRoot) {
  coreRoot.destroyPixie = attachPixie(
    coreRoot.redux,
    filterPixie(rootPixie, makeRootProps(coreRoot)),
    e => console.error(e),
    output => (coreRoot.output = output)
  )
  allDestroyPixies.push(coreRoot.destroyPixie)

  return coreRoot
}

/**
 * We use this for unit testing, to kill all core contexts.
 */
export function destroyAllContexts () {
  for (const destroyPixie of allDestroyPixies) {
    destroyPixie()
  }
  allDestroyPixies = []
}

// Props passed to the root pixie:
export interface RootProps {
  coreRoot: CoreRoot;
  +dispatch: Dispatch<RootAction>;
  io: EdgeIo;
  onError(e: Error): mixed;
  onExchangeUpdate(): mixed;
  output: RootOutput;
  plugins: Array<EdgeCorePluginFactory>;
  shapeshiftKey: string | void;
  state: RootState;
}

/**
 * Builds the root props based on a coreRoot object.
 */
export function makeRootProps (
  coreRoot: CoreRoot
): (props: ReduxProps<RootState, RootAction>) => RootProps {
  return (props: ReduxProps<RootState, RootAction>): RootProps => ({
    ...props,
    coreRoot,
    io: coreRoot.io,
    onError: coreRoot.onError,
    onExchangeUpdate: coreRoot.onExchangeUpdate,
    shapeshiftKey: coreRoot.shapeshiftKey,
    plugins: coreRoot.plugins
  })
}

/**
 * Props passed through the API objects (EdgeContext, EdgeAccount, etc.)
 */
export interface ApiProps {
  +dispatch: Dispatch<RootAction>;
  io: EdgeIo;
  loginStore: LoginStore;
  onError(e: Error): mixed;
  output: RootOutput;
  shapeshiftKey: string | void;
  state: RootState;
}

/**
 * Converts the root props to the API props format.
 */
export function makeApiProps (props: RootProps): ApiProps {
  const {
    dispatch,
    coreRoot,
    output,
    io,
    onError,
    shapeshiftKey,
    state
  } = props
  const { loginStore } = coreRoot

  return { dispatch, loginStore, output, io, onError, shapeshiftKey, state }
}

export type ApiInput = PixieInput<ApiProps>
