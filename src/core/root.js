// @flow

import { type StoreEnhancer, compose, createStore } from 'redux'
import { type ReduxProps, attachPixie, filterPixie } from 'redux-pixies'
import { emit } from 'yaob'

import { type EdgeContext, type EdgeContextOptions } from '../types/types.js'
import { type RootAction } from './actions.js'
import { makeLegacyConsole, makeLog } from './log/log.js'
import { loadStashes } from './login/login-stash.js'
import { type PluginIos, watchPlugins } from './plugins/plugins-actions.js'
import { type RootProps, rootPixie } from './root-pixie.js'
import { type RootState, reducer } from './root-reducer.js'

let allContexts: EdgeContext[] = []

const composeEnhancers =
  typeof window === 'object' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'core' })
    : compose

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export async function makeContext(
  ios: PluginIos,
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const { io, onLog } = ios
  const {
    apiKey,
    appId = '',
    authServer = 'https://auth.airbitz.co/api',
    deviceDescription = null,
    hideKeys = false,
    plugins: pluginsInit = {}
  } = opts
  const log = makeLog(onLog, 'edge-core')

  if (apiKey == null) {
    throw new Error('No API key provided')
  }

  // Load the login stashes from disk:
  const stashes = await loadStashes(io.disklet, log)

  // Start Redux:
  const enhancers: StoreEnhancer<RootState, RootAction> = composeEnhancers()
  const redux = createStore(reducer, enhancers)
  redux.dispatch({
    type: 'INIT',
    payload: {
      apiKey,
      appId,
      authServer,
      deviceDescription,
      hideKeys,
      pluginsInit,
      stashes
    }
  })

  // Subscribe to new plugins:
  const closePlugins = watchPlugins(ios, pluginsInit, redux.dispatch)

  // Start the pixie tree:
  const mirror = { output: {} }
  const closePixie = attachPixie(
    redux,
    filterPixie(
      rootPixie,
      (props: ReduxProps<RootState, RootAction>): RootProps => ({
        ...props,
        close() {
          closePixie()
          closePlugins()
          redux.dispatch({ type: 'CLOSE' })
        },
        io: { ...io, console: makeLegacyConsole(onLog) },
        log,
        onError: error => {
          if (mirror.output.context && mirror.output.context.api) {
            emit(mirror.output.context.api, 'error', error)
          }
        },
        onLog
      })
    ),
    e => log.error(e),
    output => (mirror.output = output)
  )

  const out = mirror.output.context.api
  allContexts.push(out)
  return out
}

/**
 * We use this for unit testing, to kill all core contexts.
 */
export function closeEdge(): void {
  for (const context of allContexts) context.close()
  allContexts = []
}
