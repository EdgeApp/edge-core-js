import { NetworkError } from '../error.js'
import { timeout } from '../util/promise.js'

const syncServers = ['https://git-js.airbitz.co', 'https://git4-js.airbitz.co']

/**
 * Fetches some resource from a sync server.
 */
export function syncRequest (io, method, uri, body) {
  return syncRequestInner(io, method, uri, body, 0)
}

function syncRequestInner (io, method, path, body, serverIndex) {
  const opts = {
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
  return timeout(
    io.fetch(uri, opts).then(
      response =>
        response.json().catch(jsonError => {
          throw new Error('Non-JSON reply, HTTP status ' + response.status)
        }),
      networkError => {
        throw new NetworkError('Could not reach the sync server')
      }
    ),
    10000,
    new NetworkError('Could not reach the sync server: timeout')
  ).catch(e => {
    if (serverIndex + 1 < syncServers.length) {
      return syncRequestInner(io, method, path, body, serverIndex + 1)
    } else {
      throw e
    }
  })
}
