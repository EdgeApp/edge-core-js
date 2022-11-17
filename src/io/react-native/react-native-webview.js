// @flow

import '../../client-side.js'

import * as React from 'react'
import { requireNativeComponent } from 'react-native'
import { type HttpHeaders, type HttpResponse } from 'serverlet'
import { bridgifyObject } from 'yaob'

import { type EdgeFetchOptions, NetworkError } from '../../types/types.js'
import {
  type ClientIo,
  type EdgeCoreWebView,
  type WorkerApi
} from './react-native-types.js'
import { type YaobCallbacks, makeYaobCallbacks } from './yaob-callbacks.js'

type Props = {
  allowDebugging?: boolean,
  debug?: boolean,
  onError(error: any): mixed,
  onLoad(clientIo: ClientIo, root: WorkerApi): Promise<mixed>
}

/**
 * Launches the Edge core worker in a WebView and returns its API.
 */
export class EdgeCoreBridge extends React.Component<Props> {
  callbacks: YaobCallbacks

  constructor(props: Props) {
    super(props)
    const { onError, onLoad } = props

    // Set up the native IO objects:
    const clientIo: ClientIo = bridgifyObject({
      // Networking:
      fetchCors
    })

    // Set up the YAOB bridge:
    this.callbacks = makeYaobCallbacks((root: WorkerApi) => {
      onLoad(clientIo, root).catch(onError)
    })
  }

  render(): React.Node {
    const { allowDebugging = false, debug = false, onError } = this.props

    return (
      <NativeWebView
        ref={this.callbacks.setRef}
        allowDebugging={debug || allowDebugging}
        source={debug ? 'http://localhost:8080/edge-core.js' : null}
        style={{ opacity: 0, position: 'absolute', height: 1, width: 1 }}
        onMessage={this.callbacks.handleMessage}
        onScriptError={event => {
          if (onError != null) {
            onError(new Error(`Cannot load "${event.nativeEvent.source}"`))
          }
        }}
      />
    )
  }
}

const NativeWebView: Class<EdgeCoreWebView> = requireNativeComponent(
  'EdgeCoreWebView'
)

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
