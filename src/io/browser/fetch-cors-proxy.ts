import { EdgeFetchOptions } from '../../types/types'
import { asyncWaterfall } from '../../util/asyncWaterfall'
import { shuffle } from '../../util/shuffle'

// Hard-coded CORS proxy server
const PROXY_SERVER_URLS = [
  'https://cors1.edge.app',
  'https://cors2.edge.app',
  'https://cors3.edge.app',
  'https://cors4.edge.app'
]

export const fetchCorsProxy = async (
  uri: string,
  opts?: EdgeFetchOptions
): Promise<Response> => {
  const shuffledUrls = shuffle([...PROXY_SERVER_URLS])
  const tasks = shuffledUrls.map(
    proxyServerUrl => async () =>
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
