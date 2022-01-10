// @flow

import './polyfills.js'

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
} from '../../core/core.js'
import {
  type EdgeFetchOptions,
  type EdgeFetchResponse,
  type EdgeIo
} from '../../types/types.js'
import { makeNativeBridge } from './native-bridge.js'
import { type ClientIo, type WorkerApi } from './react-native-types.js'

// Set up the bridges:
const [nativeBridge, reactBridge] =
  window.edgeCore != null
    ? [
        makeNativeBridge((id, name, args) => {
          window.edgeCore.call(id, name, JSON.stringify(args))
        }),
        new Bridge({
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
  const handleLoad = () => {
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

  return {
    console,
    disklet: {
      delete(path) {
        return nativeBridge.call('diskletDelete', normalizePath(path))
      },
      getData(path) {
        return nativeBridge
          .call('diskletGetData', normalizePath(path))
          .then((data: string) => base64.parse(data))
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
    scrypt(data, salt, n, r, p, dklen) {
      return nativeBridge
        .call(
          'scrypt',
          base64.stringify(data),
          base64.stringify(salt),
          n,
          r,
          p,
          dklen
        )
        .then((data: string) => base64.parse(data))
    },

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions): Promise<EdgeFetchResponse> {
      return window.fetch(uri, opts)
    },

    fetchCors(
      uri: string,
      opts: EdgeFetchOptions = {}
    ): Promise<EdgeFetchResponse> {
      return clientIo.fetchCors(uri, opts).then(makeFetchResponse)
    }
  }
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
    return makeContext({ io, nativeIo }, logBackend, opts)
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
