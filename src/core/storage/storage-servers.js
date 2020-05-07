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
export async function syncRequest(
  io: EdgeIo,
  log: EdgeLog,
  method: string,
  uri: string,
  body: any
): Promise<any> {
  const start = Math.floor(Math.random() * syncServers.length)

  async function loop(i: number): Promise<any> {
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
): Promise<any> {
  const opts: EdgeFetchOptions = {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    }
  }
  if (method !== 'GET') opts.body = JSON.stringify(body)

  // Do the fetch, translating the raw network error into our format:
  const uri = server + path
  const start = Date.now()
  const response = await io.fetch(uri, opts).catch(networkError => {
    const time = Date.now() - start
    const message = `${method} ${server} failed in ${time}ms, ${String(
      networkError
    )}`
    log(message)
    throw new NetworkError(message)
  })
  const time = Date.now() - start

  // Log our result and return its contents:
  const message = `${method} ${server} returned ${response.status} in ${time}ms`
  log(message)
  if (!response.ok) throw new NetworkError(message)
  return response.json()
}
