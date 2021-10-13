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

const body = document.body

/**
 * Gently pulse the background color in debug mode,
 * to show that code is loaded & running.
 */
if (body != null && /debug=true/.test(window.location.search)) {
  const update = (): void => {
    const wave = Math.abs(((Date.now() / 2000) % 2) - 1)
    const color = 0x40 + 0x80 * wave
    body.style.backgroundColor = `rgb(${color}, ${color}, ${color})`

    setTimeout(update, 100)
  }
  update()
}

window.addEdgeCorePlugins = addEdgeCorePlugins
window.lockEdgeCorePlugins = lockEdgeCorePlugins

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

const workerApi: WorkerApi = bridgifyObject({
  makeEdgeContext(clientIo, nativeIo, logBackend, opts) {
    return makeContext({ io: makeIo(clientIo), nativeIo }, logBackend, opts)
  },

  makeFakeEdgeWorld(clientIo, nativeIo, logBackend, users = []) {
    return Promise.resolve(
      makeFakeWorld({ io: makeIo(clientIo), nativeIo }, logBackend, users)
    )
  }
})

/**
 * Legacy WebView support.
 */
function oldSendRoot(): void {
  if (window.originalPostMessage != null) {
    const reactPostMessage = window.postMessage
    window.postMessage = window.originalPostMessage
    window.bridge = new Bridge({
      sendMessage: message => reactPostMessage(JSON.stringify(message))
    })
    window.bridge.sendRoot(workerApi)
  } else {
    setTimeout(oldSendRoot, 100)
  }
}

// Start the object bridge:
if (window.ReactNativeWebView != null) {
  window.bridge = new Bridge({
    sendMessage(message) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message))
    }
  })
  window.bridge.sendRoot(workerApi)
} else {
  oldSendRoot()
}
