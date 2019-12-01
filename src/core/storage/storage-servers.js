// @flow

import {
  type EdgeFetchOptions,
  type EdgeIo,
  type EdgeLog,
  NetworkError
} from '../../types/types.js'

const syncServers = [
  'https://git3.airbitz.co',
  'https://git2.airbitz.co',
  'https://git4.edge.app'
]

/**
 * Fetches some resource from a sync server.
 */
export function syncRequest(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  uri: string,
  body: any
) {
  return syncRequestInner(io, log, method, uri, body, 0)
}

function syncRequestInner(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  path: string,
  body: any,
  serverIndex: number
) {
  const opts: EdgeFetchOptions = {
    method: method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    }
  }
  if (method !== 'GET') {
    opts.body = JSON.stringify(body)
  }

  const uri = syncServers[serverIndex] + path
  log(`${method} ${uri}`)
  return io
    .fetch(uri, opts)
    .then(
      response =>
        response.json().catch(jsonError => {
          throw new Error(
            `Non-JSON reply, HTTP status ${response.status}, ${path}`
          )
        }),
      networkError => {
        throw new NetworkError('Could not reach the sync server')
      }
    )
    .catch(e => {
      if (serverIndex + 1 < syncServers.length) {
        return syncRequestInner(io, log, method, path, body, serverIndex + 1)
      } else {
        throw e
      }
    })
}
