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
import { type ClientIo, type WorkerApi } from './react-native-types.js'

// Set up the bridge:
const reactBridge =
  window.edgeCore != null
    ? new Bridge({
        sendMessage(message) {
          window.edgeCore.postMessage(JSON.stringify(message))
        }
      })
    : new Bridge({
        sendMessage(message) {
          window.webkit.messageHandlers.edgeCore.postMessage([
            'postMessage',
            [JSON.stringify(message)]
          ])
        }
      })

// Set up global objects:
window.addEdgeCorePlugins = addEdgeCorePlugins
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

function makeIo(clientIo: ClientIo): EdgeIo {
  const { disklet, entropy, scrypt } = clientIo
  const csprng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: base64.parse(entropy)
  })

  return {
    console,
    disklet,

    random: bytes => csprng.generate(bytes),
    scrypt,

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

// Send the root object:
const workerApi: WorkerApi = bridgifyObject({
  makeEdgeContext(clientIo, nativeIo, logBackend, pluginUris, opts) {
    loadPlugins(pluginUris)
    return makeContext({ io: makeIo(clientIo), nativeIo }, logBackend, opts)
  },

  makeFakeEdgeWorld(clientIo, nativeIo, logBackend, pluginUris, users = []) {
    loadPlugins(pluginUris)
    return Promise.resolve(
      makeFakeWorld({ io: makeIo(clientIo), nativeIo }, logBackend, users)
    )
  }
})
reactBridge.sendRoot(workerApi)
