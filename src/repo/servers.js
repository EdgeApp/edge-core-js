const syncServers = ['https://git-js.airbitz.co', 'https://git4-js.airbitz.co']

/**
 * Fetches some resource from a sync server.
 */
export function syncRequest (io, method, uri, body) {
  return syncRequestInner(io, method, uri, body, 0)
}

function syncRequestInner (io, method, uri, body, serverIndex) {
  uri = syncServers[serverIndex] + uri
  io.log.info(`sync: ${method} ${uri}`)
  const headers = {
    method: method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }
  if (method !== 'GET') {
    headers.body = JSON.stringify(body)
  }

  return io.fetch(uri, headers).then(
    response =>
      response.json().catch(jsonError => {
        throw new Error('Non-JSON reply, HTTP status ' + response.status)
      }),
    networkError => {
      if (serverIndex + 1 < syncServers.length) {
        return syncRequestInner(io, method, uri, body, serverIndex + 1)
      }
      throw new Error('NetworkError: Could not connect to sync server')
    }
  )
}
