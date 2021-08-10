// @flow

import { asEither, asMaybe, asNull, asObject } from 'cleaners'

import { asEdgeBox } from '../../types/server-cleaners.js'
import {
  type EdgeFetchOptions,
  type EdgeIo,
  type EdgeLog,
  NetworkError
} from '../../types/types.js'

const syncServers = [
  'https://sync-x1a1.edgetest.app',
  'https://sync-x1a2.edgetest.app',
  'https://sync-x1a3.edgetest.app',
  'https://sync-x1a4.edgetest.app',
  'https://sync-x1a5.edgetest.app',
  'https://sync-x1a6.edgetest.app',
  'https://sync-x1b1.edgetest.app',
  'https://sync-x1b2.edgetest.app',
  'https://sync-x1b3.edgetest.app',
  'https://sync-x1b4.edgetest.app',
  'https://sync-x1b5.edgetest.app',
  'https://sync-x1b6.edgetest.app'
  // 'https://git1.edge.app',
  // 'https://git3.airbitz.co',
  // 'https://git4.edge.app'
]

type SyncReply = {
  changes?: { [path: string]: any },
  hash?: string
}

/**
 * Fetches some resource from a sync server.
 */
export async function syncRequest(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  uri: string,
  body: any
): Promise<SyncReply> {
  const start = Math.floor(Math.random() * syncServers.length)

  async function loop(i: number): Promise<SyncReply> {
    const server = syncServers[(start + i) % syncServers.length]
    const promise = syncRequestInner(io, log, method, uri, body, server)
    return i < syncServers.length ? promise.catch(() => loop(i + 1)) : promise
  }
  return loop(0)
}

export async function syncRequestInner(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  path: string,
  body: any,
  server: string
): Promise<SyncReply> {
  const opts: EdgeFetchOptions = {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    }
  }
  if (method !== 'GET') opts.body = JSON.stringify(body)

  // Do the fetch, translating the raw network error into our format:
  const uri = `${server}${path}`
  const start = Date.now()

  // <TESTING ONLY>
  logExtra(log, 'request', method, uri, body)
  // </TESTING ONLY>

  const response = await io.fetch(uri, opts).catch(error => {
    const time = Date.now() - start
    const message = `${method} ${server} failed in ${time}ms, ${String(error)}`
    log.error(message)
    throw new NetworkError(message)
  })
  const time = Date.now() - start
  const message = `${method} ${uri} returned ${response.status} in ${time}ms`

  // Log our result and return its contents:
  if (!response.ok) {
    log.error(message)
    throw new NetworkError(message)
  }
  log(message)

  // <TESTING ONLY>
  const responseBody = await response.json()
  logExtra(log, 'response', method, uri, responseBody)
  // </TESTING ONLY>

  return responseBody
}

// <TESTING ONLY>
type ChangeSummary = {
  [key: string]: string | null
}
function logExtra(
  log: EdgeLog,
  messageType: 'request' | 'response',
  method: string,
  uri: string,
  body: any
): void {
  const logStart = `${method} ${uri} ${messageType}`

  const bodyCleaned = asMaybe(
    asObject({
      changes: asObject(asEither(asNull, asEdgeBox))
    })
  )(body)

  if (bodyCleaned == null) {
    log.warn(`${logStart} body: ${JSON.stringify(body)}`)
    return
  }

  const changeSummary: ChangeSummary = {}

  for (const [key, value] of Object.entries(bodyCleaned.changes)) {
    if (value === null) {
      changeSummary[key] = null
    }
    if (value !== null) {
      // $FlowFixMe
      const data = value.data_base64
      changeSummary[key] = data.slice(0, Math.min(8, data.length))
    }
  }

  log.warn(
    `${logStart} changeSummary: ${JSON.stringify(changeSummary, null, 2)}`
  )
}
// </TESTING ONLY>
