// @flow

import '../../client-side.js'

import { makeReactNativeDisklet } from 'disklet'
import * as React from 'react'
import { NativeModules, Platform, StyleSheet, View } from 'react-native'
import { scrypt } from 'react-native-fast-crypto'
import RNFS from 'react-native-fs'
import { WebView } from 'react-native-webview'
import { type HttpHeaders, type HttpResponse } from 'serverlet'
import { bridgifyObject } from 'yaob'

import { type EdgeFetchOptions, NetworkError } from '../../types/types.js'
import { type ClientIo, type WorkerApi } from './react-native-types.js'
import { type YaobCallbacks, makeYaobCallbacks } from './yaob-callbacks.js'

type Props = {
  debug?: boolean,
  onError(e: any): mixed,
  onLoad(clientIo: ClientIo, root: WorkerApi): Promise<mixed>
}

/**
 * Launches the Edge core worker in a WebView and returns its API.
 */
export class EdgeCoreBridge extends React.Component<Props> {
  callbacks: YaobCallbacks

  constructor(props: Props) {
    super(props)
    const { debug = false, onError, onLoad } = props

    // Set up the native IO objects:
    const clientIoPromise = new Promise((resolve, reject) => {
      randomBytes(32, (error, base64String) => {
        if (error != null) return reject(error)

        const out: ClientIo = {
          // Crypto:
          entropy: base64String,
          scrypt,

          // Local IO:
          disklet: bridgifyObject(makeReactNativeDisklet()),

          // Networking:
          fetchCors
        }
        resolve(bridgifyObject(out))
      })
    })

    // Set up the YAOB bridge:
    this.callbacks = makeYaobCallbacks(
      (root: WorkerApi) => {
        clientIoPromise
          .then(nativeIo => onLoad(nativeIo, root))
          .catch(error => onError(error))
      },
      debug ? 'edge-core' : undefined
    )
  }

  render(): React.Node {
    const { debug = false } = this.props
    let uri =
      Platform.OS === 'android'
        ? 'file:///android_asset/edge-core/index.html'
        : `file://${RNFS.MainBundlePath}/edge-core/index.html`
    if (debug) {
      uri += '?debug=true'
      console.log(`edge core at ${uri}`)
    }

    return (
      <View style={debug ? styles.debug : styles.hidden}>
        <WebView
          allowFileAccess
          onMessage={this.callbacks.handleMessage}
          originWhitelist={['file://*']}
          ref={this.callbacks.setRef}
          source={{ uri }}
        />
      </View>
    )
  }
}

const { randomBytes } = NativeModules.RNRandomBytes

/**
 * Turns XMLHttpRequest headers into a more JSON-like structure.
 */
function extractHeaders(headers: string): HttpHeaders {
  const pairs = headers.split('\r\n')

  const out: HttpHeaders = {}
  for (const pair of pairs) {
    const index = pair.indexOf(': ')
    if (index < 0) continue
    out[pair.slice(0, index).toLowerCase()] = pair.slice(index + 2)
  }
  return out
}

/**
 * Fetches data from the React Native side, where CORS doesn't apply.
 */
function fetchCors(
  uri: string,
  opts: EdgeFetchOptions = {}
): Promise<HttpResponse> {
  const { body, headers = {}, method = 'GET' } = opts

  return new Promise((resolve, reject) => {
    const xhr = new window.XMLHttpRequest()

    // Event handlers:
    function handleError(): void {
      reject(new NetworkError(`Could not reach ${uri}`))
    }

    function handleLoad(): void {
      const headers = xhr.getAllResponseHeaders()
      resolve({
        body: xhr.response,
        headers: extractHeaders(headers == null ? '' : headers),
        status: xhr.status
      })
    }

    // Set up the request:
    xhr.open(method, uri, true)
    xhr.responseType = 'arraybuffer'
    xhr.onerror = handleError
    xhr.ontimeout = handleError
    xhr.onload = handleLoad
    for (const name of Object.keys(headers)) {
      xhr.setRequestHeader(name, headers[name])
    }
    xhr.send(body)
  })
}

const styles = StyleSheet.create({
  debug: {
    alignSelf: 'center',
    position: 'absolute',
    height: 10,
    width: 10,
    top: 50
  },
  hidden: { position: 'absolute', height: 0, width: 0 }
})
