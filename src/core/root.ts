import { makeSyncClient } from 'edge-sync-client'
import { createStore } from 'redux'
import { attachPixie, filterPixie, ReduxProps } from 'redux-pixies'
import { emit } from 'yaob'

import { EdgeContext, EdgeContextOptions } from '../types/types'
import { validateServer } from '../util/validateServer'
import { Dispatch } from './actions'
import { CLIENT_FILE_NAME, clientFile } from './context/client-file'
import { INFO_CACHE_FILE_NAME, infoCacheFile } from './context/info-cache-file'
import { filterLogs, LogBackend, makeLog } from './log/log'
import { loadAirbitzStashes } from './login/airbitz-stashes'
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
    airbitzSupport = false,
    apiKey = '4248c1bf41e53b840a5fdb2c872dd3ade525e66d',
    apiSecret,
    appId = '',
    authServer = 'https://login.edge.app/api',
    deviceDescription = null,
    hideKeys = false,
    infoServer,
    plugins: pluginsInit = {},
    skipBlockHeight = false,
    syncServer
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

  // Load the login stashes from disk:
  let [clientInfo, infoCache = {}, stashes] = await Promise.all([
    clientFile.load(io.disklet, CLIENT_FILE_NAME),
    infoCacheFile.load(io.disklet, INFO_CACHE_FILE_NAME),
    loadStashes(io.disklet, log)
  ])

  // Load legacy stashes from disk
  if (airbitzSupport) {
    // Edge will write modern files to disk at login time,
    // but it won't delete the legacy Airbitz data.
    // Once this happens, we need to ignore the legacy files
    // and just use the new files:
    const avoidUsernames = new Set<string>()
    for (const { username } of stashes) {
      if (username != null) avoidUsernames.add(username)
    }

    const airbitzStashes = await loadAirbitzStashes(io, avoidUsernames)
    stashes.push(...airbitzStashes)
  }

  // Save the clientId if we don't have one:
  if (clientInfo == null) {
    clientInfo = { clientId: io.random(16) }
    await clientFile.save(io.disklet, CLIENT_FILE_NAME, clientInfo)
  }

  // Write everything to redux:
  redux.dispatch({
    type: 'INIT',
    payload: {
      apiKey,
      apiSecret,
      appId,
      authServer,
      infoCache,
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
    infoCache,
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
