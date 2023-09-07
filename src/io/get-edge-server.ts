/**
 * Utility routines to get Edge servers which will automatically grab the
 * latest server list from the info servers. This should be moved into a
 * client library like edge-client-tools but this can be a testbed for now
 */

import { asArray, asObject, asOptional, asString } from 'cleaners'

import { asyncWaterfall } from '../util/asyncWaterfall'
import { shuffle } from '../util/shuffle'

const UPDATE_FREQ = 60 * 1000 * 10 // 10 mins

const corsServers = [
  'https://cors1.edge.app',
  'https://cors2.edge.app',
  'https://cors3.edge.app',
  'https://cors4.edge.app'
]
const infoServers = ['https://info1.edge.app', 'https://info2.edge.app']
const loginServers = ['https://auth.airbitz.co']
const logsServers = ['logs1.edge.app']
const ratesServers = ['rates1.edge.app', 'rates2.edge.app']
const referralServers = ['https://referral1.edge.app']
const syncServers = [
  'https://sync-us1.edge.app',
  'https://sync-us2.edge.app',
  'https://sync-us3.edge.app',
  'https://sync-us4.edge.app',
  'https://sync-us5.edge.app',
  'https://sync-us6.edge.app'
]

const asEdgeServers = asObject({
  corsServers: asOptional(asArray(asString), corsServers),
  infoServers: asOptional(asArray(asString), infoServers),
  loginServers: asOptional(asArray(asString), loginServers),
  logsServers: asOptional(asArray(asString), logsServers),
  ratesServers: asOptional(asArray(asString), ratesServers),
  referralServers: asOptional(asArray(asString), referralServers),
  syncServers: asOptional(asArray(asString), syncServers)
})

export type EdgeServers = ReturnType<typeof asEdgeServers>

let _servers: EdgeServers = {
  corsServers,
  infoServers,
  loginServers,
  logsServers,
  ratesServers,
  referralServers,
  syncServers
}

// Hard-coded starting server list
export type EdgeServerType = keyof EdgeServers

let lastUpdate = 0
let updating = false

const updateServers = async (): Promise<void> => {
  const now = Date.now()
  if (lastUpdate + UPDATE_FREQ < now && !updating) {
    updating = true
    try {
      const shuffledUrls = shuffle([...(_servers.infoServers ?? [])])
      const tasks = shuffledUrls.map(proxyServerUrl => async () =>
        await window.fetch(`${proxyServerUrl}/v1/edgeServers`)
      )
      const response = await asyncWaterfall(tasks)
      const responseJson = await response.json()
      const edgeServers = asEdgeServers(responseJson)
      _servers = edgeServers
    } catch (e) {
    } finally {
      updating = false
      lastUpdate = Date.now()
    }
  }
}

export const getEdgeServer = (type: EdgeServerType): string | void => {
  updateServers().catch(e => console.error(String(e)))
  const urls = _servers[type] ?? []
  const shuffledUrls = shuffle([...urls])
  if (shuffledUrls.length > 0) {
    console.log(`${type}: ${shuffledUrls.toString()}`)
    return shuffledUrls[0]
  }
}

export const getEdgeServers = (type: EdgeServerType): string[] => {
  updateServers().catch(e => console.error(String(e)))
  const urls = _servers[type] ?? []
  const shuffledUrls = shuffle([...urls])
  return shuffledUrls
}
