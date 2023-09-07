import { EdgeFetchOptions } from '../types/types'
import { asyncWaterfall } from '../util/asyncWaterfall'
import { getEdgeServers } from './get-edge-server'

export const fetchCorsProxy = async (
  uri: string,
  opts?: EdgeFetchOptions
): Promise<Response> => {
  const shuffledUrls = getEdgeServers('corsServers')
  const tasks = shuffledUrls.map(proxyServerUrl => async () =>
    await window.fetch(proxyServerUrl, {
      ...opts,
      headers: {
        ...opts?.headers,
        'x-proxy-url': uri
      }
    })
  )
  return await asyncWaterfall(tasks)
}
