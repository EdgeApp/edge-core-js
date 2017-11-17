// @flow
import type { AbcContextOptions, AbcCorePlugin } from 'airbitz-core-types'
import type { Dispatch, Store } from 'redux'
import { attachPixie, filterPixie } from 'redux-pixies'
import type { PixieInput, ReduxProps } from 'redux-pixies'

import { stashFakeUser } from '../io/fake/fakeUser.js'
import { makeFakeIos } from '../io/fake/index.js'
import type { FixedIo } from '../io/fixIo.js'
import { fixIo } from '../io/fixIo.js'
import { makeBrowserIo } from '../io/browser'
import type { RootAction } from './actions.js'
import { LoginStore } from './login/loginStore.js'
import { makeStore } from './makeStore.js'
import { rootPixie } from './rootPixie.js'
import type { RootOutput } from './rootPixie.js'
import type { RootState } from './rootReducer.js'

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
  io: FixedIo;
  onError(e: Error): void;
  onExchangeUpdate(): void;
  plugins: Array<AbcCorePlugin>;
  shapeshiftKey: string | void;

  // Loose objects:
  loginStore: any;

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
export function makeCoreRoot (opts: AbcContextOptions) {
  const onErrorDefault = (error, name) => fixedIo.console.error(name, error)

  const {
    apiKey = '!invalid',
    authServer = 'https://auth.airbitz.co/api',
    callbacks = {},
    io = makeBrowserIo(),
    plugins = [],
    shapeshiftKey = void 0
  } = opts
  const { onError = onErrorDefault, onExchangeUpdate = nop } = callbacks

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
    onExchangeUpdate,
    plugins,
    shapeshiftKey,
    loginStore: new LoginStore(fixedIo),
    redux: makeStore(),
    output: ({}: any)
  }
  coreRoot.redux.dispatch({
    type: 'INIT',
    payload: { io: fixedIo, onError, apiKey, appId, authServer }
  })

  return coreRoot
}

/**
 * Attaches pixies to the core root, begining all background work.
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
 * Makes a bunch of coreRoot objects with fake io's for unit-testing.
 */
export function makeFakeCoreRoots (
  ...opts: Array<AbcContextOptions>
): Array<CoreRoot> {
  return makeFakeIos(opts.length).map((io, i) => {
    const coreRoot: CoreRoot = makeCoreRoot({ ...opts[i], io })
    if (opts[i].localFakeUser) stashFakeUser(coreRoot.io)
    return coreRoot
  })
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
  io: FixedIo;
  onError(e: Error): void;
  onExchangeUpdate(): void;
  output: RootOutput;
  plugins: Array<AbcCorePlugin>;
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
 * Props passed through the API objects (AbcContext, AbcAccount, etc.)
 */
export interface ApiProps {
  +dispatch: Dispatch<RootAction>;
  io: FixedIo;
  loginStore: any;
  onError(e: Error): void;
  output: RootOutput;
  shapeshiftKey: string | void;
  state: RootState;
}

/**
 * Converts the root props to the API props format.
 */
export function makeApiProps (props: RootProps): ApiProps | void {
  if (!props.output) return
  const {
    dispatch,
    coreRoot,
    output,
    io,
    onError,
    shapeshiftKey,
    state
  } = props

  return {
    dispatch,
    loginStore: coreRoot.loginStore,
    output,
    io,
    onError,
    shapeshiftKey,
    state
  }
}

export type ApiInput = PixieInput<ApiProps>
