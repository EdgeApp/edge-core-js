import { mixFetch } from '@nymproject/mix-fetch'
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
  EdgeFetchFunction,
  EdgeFetchOptions,
  EdgeFetchResponse,
  EdgeIo
} from '../../types/types'
import { hideProperties } from '../hidden-properties'
import { makeNativeBridge } from './native-bridge'
import { mixFetchOptions } from './nym'
import { WorkerApi, YAOB_THROTTLE_MS } from './react-native-types'

// Tracks the status of different URI endpoints for the CORS bouncer:
const endpointCorsState = new Map<
  string,
  {
    // The window.fetch worked:
    windowSuccess: boolean

    // The nativeFetch worked:
    nativeSuccess: boolean
  }
>()

// Set up the bridges:
const [nativeBridge, reactBridge] =
  window.edgeCore != null
    ? [
        // Android:
        makeNativeBridge((id, name, args) => {
          window.edgeCore.call(id, name, JSON.stringify(args))
        }),
        new Bridge({
          hideProperties,
          sendMessage(message) {
            window.edgeCore.postMessage(JSON.stringify(message))
          },
          throttleMs: YAOB_THROTTLE_MS
        })
      ]
    : [
        // iOS:
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
          throttleMs: YAOB_THROTTLE_MS
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

async function makeIo(): Promise<EdgeIo> {
  const csprng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: base64.parse(await nativeBridge.call('randomBytes', 32))
  })

  const nativeFetch: EdgeFetchFunction = async (uri, opts = {}) => {
    const { method = 'GET', headers = {}, body } = opts
    const response = await nativeBridge.call(
      'fetch',
      uri,
      method,
      headers,
      body instanceof ArrayBuffer
        ? base64.stringify(new Uint8Array(body))
        : body,
      body instanceof ArrayBuffer
    )

    return makeFetchResponse({
      status: response.status,
      headers: response.headers,
      body: response.bodyIsBase64 ? base64.parse(response.body) : response.body
    })
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
      const { corsBypass = 'auto', privacy = 'none' } = opts ?? {}

      if (privacy === 'none') {
        try {
          const response = await mixFetch(
            uri,
            { ...opts, mode: 'unsafe-ignore-cors' },
            mixFetchOptions
          )
          return response
        } catch (error) {
          console.error('error', error)
          throw error
        }
      }
      if (corsBypass === 'always') {
        return await nativeFetch(uri, opts)
      }
      if (corsBypass === 'never') {
        return await window.fetch(uri, opts)
      }

      const { protocol, host, pathname } = new URL(uri)
      const endpoint = `${protocol}//${host}${pathname}`
      const state = endpointCorsState.get(endpoint) ?? {
        windowSuccess: false,
        nativeSuccess: false
      }
      if (!endpointCorsState.has(endpoint)) {
        endpointCorsState.set(endpoint, state)
      }

      // If the native fetch worked,
      // then we can guess that the server has a CORS problem,
      // so don't even bother with `window.fetch`:
      if (!state.nativeSuccess) {
        try {
          const response = await window.fetch(uri, opts)
          state.windowSuccess = true
          return response
        } catch (error: unknown) {
          // If `window.fetch` has ever worked,
          // then we know the server has the right CORS headers,
          // so don't even bother with the native fallback:
          if (state.windowSuccess) throw error
        }
      }

      const response = await nativeFetch(uri, opts)
      state.nativeSuccess = true
      return response
    },

    async fetchCors(
      uri: string,
      opts: EdgeFetchOptions = {}
    ): Promise<EdgeFetchResponse> {
      return await io.fetch(uri, opts)
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
  async makeEdgeContext(nativeIo, logBackend, pluginUris, opts) {
    loadPlugins(pluginUris)
    const io = await makeIo()
    return await makeContext({ io, nativeIo }, logBackend, opts)
  },

  async makeFakeEdgeWorld(nativeIo, logBackend, pluginUris, users = []) {
    loadPlugins(pluginUris)
    const io = await makeIo()
    return makeFakeWorld({ io, nativeIo }, logBackend, users)
  }
})
reactBridge.sendRoot(workerApi)
