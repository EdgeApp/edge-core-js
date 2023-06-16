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
import {
  asMaybeNetworkError,
  EdgeFetchOptions,
  EdgeFetchResponse,
  EdgeIo,
  NetworkError
} from '../../types/types'
import { fetchCorsProxy } from '../fetch-cors-proxy'
import { hideProperties } from '../hidden-properties'
import { makeNativeBridge } from './native-bridge'
import { ClientIo, WorkerApi } from './react-native-types'

// Only try CORS proxy/bridge techniques up to 5 times
const MAX_CORS_FAILURE_COUNT = 5

// A map of domains that failed CORS and succeeded via the CORS proxy server
const hostnameProxyWhitelist = new Set<string>()

// A map of domains that failed CORS and failed via the CORS proxy server and succeeded via native fetch
const hostnameBridgeProxyWhitelist = new Set<string>()

// A map of domains that failed all CORS techniques and should not re-attempt CORS techniques
const hostnameCorsProxyBlacklist = new Map<string, number>()

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
          },
          throttleMs: 500
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
          },
          throttleMs: 500
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
      opts?: EdgeFetchOptions
    ): Promise<EdgeFetchResponse> {
      return await window.fetch(uri, opts)
    },

    async fetchCors(
      uri: string,
      opts: EdgeFetchOptions = {}
    ): Promise<EdgeFetchResponse> {
      const { hostname } = new URL(uri)
      const corsFailureCount = hostnameCorsProxyBlacklist.get(hostname) ?? 0

      let doFetch = true
      let doFetchCors = true

      if (corsFailureCount < MAX_CORS_FAILURE_COUNT) {
        if (hostnameBridgeProxyWhitelist.has(hostname)) {
          // Proactively use bridgeFetch for any hostnames added to whitelist:
          doFetch = false
          doFetchCors = false
        } else if (hostnameProxyWhitelist.has(hostname)) {
          // Proactively use fetchCorsProxy for any hostnames added to whitelist:
          doFetch = false
        }
      }

      let errorToThrow
      if (doFetch) {
        try {
          // Attempt regular fetch:
          return await window.fetch(uri, opts)
        } catch (error) {
          // If we exhaust attempts to use CORS-safe fetch, then throw the error:
          if (corsFailureCount >= MAX_CORS_FAILURE_COUNT) {
            throw error
          }
          errorToThrow = error
        }
      }

      if (doFetchCors) {
        try {
          const response = await fetchCorsProxy(uri, opts)
          if (response.status === 418) {
            throw new NetworkError()
          }
          hostnameProxyWhitelist.add(hostname)
          return response
        } catch (error) {
          if (errorToThrow == null && asMaybeNetworkError(error) == null)
            errorToThrow = error
        }
      }

      // Fallback to bridge fetch if everything else fails
      try {
        const response = await bridgeFetch(uri, opts)
        hostnameBridgeProxyWhitelist.add(hostname)
        return response
      } catch (error) {
        if (errorToThrow == null) errorToThrow = error
      }

      // We failed all CORS techniques, so track attempts
      hostnameCorsProxyBlacklist.set(hostname, corsFailureCount + 1)

      // Throw the error from the first fetch instead of the one from
      // proxy server.
      throw errorToThrow
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
