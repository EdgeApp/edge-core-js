import './polyfills'

import hashjs from 'hash.js'
import HmacDRBG from 'hmac-drbg'
import { base64 } from 'rfc4648'
import { makeFetchResponse } from 'serverlet'
import { Bridge, bridgifyObject } from 'yaob'

import {
  addEdgeCorePlugins,
  lockEdgeCorePlugins,
  makeContext,
  makeFakeWorld
} from '../../core/core'
import { EdgeFetchOptions, EdgeFetchResponse, EdgeIo } from '../../types/types'
import { asyncWaterfall } from '../../util/asyncWaterfall'
import { shuffle } from '../../util/shuffle'
import { hideProperties } from '../hidden-properties'
import { makeNativeBridge } from './native-bridge'
import { ClientIo, WorkerApi } from './react-native-types'

// Hard-coded CORS proxy server
const PROXY_SERVER_URLS = ['https://cors1.edge.app', 'https://cors2.edge.app']
// A map of domains that failed CORS and succeeded via the CORS proxy server
const hostnameProxyWhitelist = new Map<string, true>()
// A map of domains that failed CORS and failed via the CORS proxy server and succeeded via native fetch
const hostnameBridgeProxyWhitelist = new Map<string, true>()

// Set up the bridges:
const [nativeBridge, reactBridge] =
  window.edgeCore != null
    ? [
        makeNativeBridge((id, name, args) => {
          window.edgeCore.call(id, name, JSON.stringify(args))
        }),
        new Bridge({
          hideProperties,
          sendMessage(message) {
            window.edgeCore.postMessage(JSON.stringify(message))
          }
        })
      ]
    : [
        makeNativeBridge((id, name, args) => {
          window.webkit.messageHandlers.edgeCore.postMessage([id, name, args])
        }),
        new Bridge({
          hideProperties,
          sendMessage(message) {
            window.webkit.messageHandlers.edgeCore.postMessage([
              0,
              'postMessage',
              [JSON.stringify(message)]
            ])
          }
        })
      ]

// Set up global objects:
window.addEdgeCorePlugins = addEdgeCorePlugins
window.nativeBridge = nativeBridge
window.reactBridge = reactBridge

function loadPlugins(pluginUris: string[]): void {
  const { head } = window.document
  if (head == null || pluginUris.length === 0) {
    lockEdgeCorePlugins()
    return
  }

  let loaded: number = 0
  const handleLoad = (): void => {
    if (++loaded >= pluginUris.length) lockEdgeCorePlugins()
  }

  for (const uri of pluginUris) {
    const script = document.createElement('script')
    script.addEventListener('error', handleLoad)
    script.addEventListener('load', handleLoad)
    script.charset = 'utf-8'
    script.defer = true
    script.src = uri
    head.appendChild(script)
  }
}

async function makeIo(clientIo: ClientIo): Promise<EdgeIo> {
  const csprng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: base64.parse(await nativeBridge.call('randomBytes', 32))
  })

  const bridgeFetch = async (
    uri: string,
    opts: EdgeFetchOptions
  ): Promise<EdgeFetchResponse> => {
    const response = await clientIo.fetchCors(uri, opts)
    return makeFetchResponse(response)
  }

  const io: EdgeIo = {
    disklet: {
      delete(path) {
        return nativeBridge.call('diskletDelete', normalizePath(path))
      },
      async getData(path) {
        const data: string = await nativeBridge.call(
          'diskletGetData',
          normalizePath(path)
        )
        return base64.parse(data)
      },
      getText(path) {
        return nativeBridge.call('diskletGetText', normalizePath(path))
      },
      list(path = '') {
        return nativeBridge.call('diskletList', normalizePath(path))
      },
      setData(path, data: any) {
        return nativeBridge.call(
          'diskletSetData',
          normalizePath(path),
          base64.stringify(data)
        )
      },
      setText(path, text) {
        return nativeBridge.call('diskletSetText', normalizePath(path), text)
      }
    },

    random: bytes => csprng.generate(bytes),

    async scrypt(data, salt, n, r, p, dklen) {
      const hash: string = await nativeBridge.call(
        'scrypt',
        base64.stringify(data),
        base64.stringify(salt),
        n,
        r,
        p,
        dklen
      )
      return base64.parse(hash)
    },

    // Networking:
    async fetch(
      uri: string,
      opts: EdgeFetchOptions = {}
    ): Promise<EdgeFetchResponse> {
      const { hostname } = new URL(uri)

      // Proactively use bridgeFetch for any hostnames added to whitelist:
      if (hostnameBridgeProxyWhitelist.get(hostname) === true) {
        return await bridgeFetch(uri, opts)
      }
      // Proactively use fetchCorsProxy for any hostnames added to whitelist:
      if (hostnameProxyWhitelist.get(hostname) === true) {
        return await fetchCorsProxy(uri, opts)
      }

      try {
        // Attempt regular fetch:
        return await window.fetch(uri, opts)
      } catch (error) {
        // Fallback to edge-core-proxy server if this is a CORS error:
        if (String(error) === 'TypeError: Load failed') {
          try {
            const response = await fetchCorsProxy(uri, opts)
            hostnameProxyWhitelist.set(hostname, true)
            return response
          } catch (_) {
            // Fallback to bridge fetch if everything else fails
            try {
              const response = await bridgeFetch(uri, opts)
              hostnameBridgeProxyWhitelist.set(hostname, true)
              return response
            } catch (_) {}
            // Throw the error from the first fetch instead of the one from
            // proxy server.
            throw error
          }
        }
        // Not a CORS error:
        throw error
      }
    },

    fetchCors(
      uri: string,
      opts: EdgeFetchOptions = {}
    ): Promise<EdgeFetchResponse> {
      return io.fetch(uri, opts)
    }
  }

  return io
}

/**
 * Interprets a path as a series of folder lookups,
 * handling special components like `.` and `..`.
 */
export function normalizePath(path: string): string {
  if (/^\//.test(path)) throw new Error('Absolute paths are not supported')
  const parts = path.split('/')

  // Shift down good elements, dropping bad ones:
  let i = 0 // Read index
  let j = 0 // Write index
  while (i < parts.length) {
    const part = parts[i++]
    if (part === '..') j--
    else if (part !== '.' && part !== '') parts[j++] = part

    if (j < 0) throw new Error('Path would escape folder')
  }

  // Array items from 0 to j are the path:
  return parts.slice(0, j).join('/')
}

// Send the root object:
const workerApi: WorkerApi = bridgifyObject({
  async makeEdgeContext(clientIo, nativeIo, logBackend, pluginUris, opts) {
    loadPlugins(pluginUris)
    const io = await makeIo(clientIo)
    return await makeContext({ io, nativeIo }, logBackend, opts)
  },

  async makeFakeEdgeWorld(
    clientIo,
    nativeIo,
    logBackend,
    pluginUris,
    users = []
  ) {
    loadPlugins(pluginUris)
    const io = await makeIo(clientIo)
    return makeFakeWorld({ io, nativeIo }, logBackend, users)
  }
})
reactBridge.sendRoot(workerApi)

const fetchCorsProxy = async (
  uri: string,
  opts: EdgeFetchOptions
): Promise<Response> => {
  const shuffledUrls = shuffle([...PROXY_SERVER_URLS])
  const tasks = shuffledUrls.map(proxyServerUrl => async () =>
    await window.fetch(proxyServerUrl, {
      ...opts,
      headers: {
        ...opts.headers,
        'x-proxy-url': uri
      }
    })
  )
  return await asyncWaterfall(tasks)
}
