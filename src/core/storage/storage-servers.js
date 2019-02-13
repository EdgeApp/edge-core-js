// @flow

import { type EdgeIo, NetworkError } from '../../types/types.js'

const syncServers = [
  'https://git3.airbitz.co',
  'https://git2.airbitz.co',
  'https://git4.edge.app'
]

/**
 * Fetches some resource from a sync server.
 */
export function syncRequest (
  io: EdgeIo,
  method: string,
  uri: string,
  body: Object
) {
  return syncRequestInner(io, method, uri, body, 0)
}

function syncRequestInner (io, method, path, body, serverIndex) {
  const opts: Object = {
    method: method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }
  if (method !== 'GET') {
    opts.body = JSON.stringify(body)
  }

  const uri = syncServers[serverIndex] + path
  io.console.info(`${method} ${uri}`)
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
        return syncRequestInner(io, method, path, body, serverIndex + 1)
      } else {
        throw e
      }
    })
}
