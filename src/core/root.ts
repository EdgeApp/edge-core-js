import { makeSyncClient } from 'edge-sync-client'
import { createStore } from 'redux'
import { attachPixie, filterPixie, ReduxProps } from 'redux-pixies'
import { emit } from 'yaob'

import { EdgeContext, EdgeContextOptions } from '../types/types'
import { validateServer } from '../util/validateServer'
import { Dispatch } from './actions'
import { CLIENT_FILE_NAME, clientFile } from './context/client-file'
import { filterLogs, LogBackend, makeLog } from './log/log'
import { loadStashes } from './login/login-stash'
import { PluginIos, watchPlugins } from './plugins/plugins-actions'
import { RootOutput, rootPixie, RootProps } from './root-pixie'
import { defaultLogSettings, reducer, RootState } from './root-reducer'

let allContexts: EdgeContext[] = []

const enhancer =
  typeof window === 'object' && window.__REDUX_DEVTOOLS_EXTENSION__ != null
    ? window.__REDUX_DEVTOOLS_EXTENSION__({ name: 'core' })
    : undefined

/**
 * Creates the root object for the entire core state machine.
 * This core object contains the `io` object, context options,
 * Redux store, and tree of background workers.
 */
export async function makeContext(
  ios: PluginIos,
  logBackend: LogBackend,
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const { io } = ios
  const {
    apiKey,
    appId = '',
    authServer = 'https://login.edge.app/api',
    infoServer,
    syncServer,
    deviceDescription = null,
    hideKeys = false,
    plugins: pluginsInit = {},
    skipBlockHeight = false
  } = opts
  const infoServers =
    typeof infoServer === 'string'
      ? [infoServer]
      : infoServer != null && infoServer.length > 0
      ? infoServer
      : ['https://info-eu1.edge.app', 'https://info-us1.edge.app']
  const syncServers =
    typeof syncServer === 'string'
      ? [syncServer]
      : syncServer != null && syncServer.length > 0
      ? syncServer
      : [
          'https://sync-us1.edge.app',
          'https://sync-us2.edge.app',
          'https://sync-us3.edge.app',
          'https://sync-us4.edge.app',
          'https://sync-us5.edge.app',
          'https://sync-us6.edge.app',
          'https://sync-eu.edge.app'
        ]
  const logSettings = { ...defaultLogSettings, ...opts.logSettings }
  if (apiKey == null) {
    throw new Error('No API key provided')
  }

  validateServer(authServer)
  infoServers.map(server => validateServer(server))
  syncServers.map(server => validateServer(server))

  // Create a redux store:
  const redux = createStore(reducer, enhancer)

  // Create a log wrapper, using the settings from redux:
  logBackend = filterLogs(logBackend, () => {
    const state = redux.getState()
    return state.ready ? state.logSettings : logSettings
  })
  const log = makeLog(logBackend, 'edge-core')

  // Load the clientId from disk:
  let clientInfo = await clientFile.load(io.disklet, CLIENT_FILE_NAME)
  if (clientInfo == null) {
    clientInfo = { clientId: io.random(16) }
    await clientFile.save(io.disklet, CLIENT_FILE_NAME, clientInfo)
  }

  // Load the login stashes from disk:
  const stashes = await loadStashes(io.disklet, log)
  redux.dispatch({
    type: 'INIT',
    payload: {
      apiKey,
      appId,
      authServer,
      infoServers,
      syncServers,
      clientId: clientInfo.clientId,
      deviceDescription,
      hideKeys,
      logSettings,
      pluginsInit,
      skipBlockHeight,
      stashes
    }
  })

  // Subscribe to new plugins:
  const closePlugins = watchPlugins(
    ios,
    logBackend,
    pluginsInit,
    redux.dispatch
  )

  // Create sync client:
  const syncClient = makeSyncClient({
    log,
    fetch: io.fetch,
    edgeServers: { infoServers, syncServers }
  })

  // Start the pixie tree:
  const mirror: { output: RootOutput } = { output: {} as any }
  const closePixie = attachPixie(
    redux,
    filterPixie(
      rootPixie,
      (props: ReduxProps<RootState, Dispatch>): RootProps => ({
        ...props,
        close() {
          closePixie()
          closePlugins()
          redux.dispatch({ type: 'CLOSE' })
        },
        io,
        log,
        logBackend,
        onError: error => {
          if (mirror.output.context?.api != null) {
            emit(mirror.output.context.api, 'error', error)
          }
        },
        syncClient
      })
    ),
    error => log.error(error),
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
  for (const context of allContexts) context.close().catch(() => {})
  allContexts = []
}
