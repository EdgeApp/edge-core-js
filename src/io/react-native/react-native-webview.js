// @flow

import '../../client-side.js'

import React, { Component } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import RNFS from 'react-native-fs'
import { WebView } from 'react-native-webview'
import { Bridge, bridgifyObject, onMethod } from 'yaob'

import { type EdgeNativeIo } from '../../types/types.js'
import { makeClientIo } from './react-native-io.js'
import { type WorkerApi } from './react-native-types.js'

type Props = {
  debug?: boolean,
  onError(e: Object): mixed,
  onLoad(nativeIo: EdgeNativeIo, root: WorkerApi): Promise<mixed>,
  nativeIo?: EdgeNativeIo
}

type WebViewCallbacks = {
  onMessage: Function,
  setRef: Function
}

/**
 * Sets up a YAOB bridge for use with a React Native WebView.
 * The returned callbacks should be passed to the `onMessage` and `ref`
 * properties of the WebView. Handles WebView reloads and related
 * race conditions.
 * @param {*} onRoot Called when the inner HTML sends a root object.
 * May be called multiple times if the inner HTML reloads.
 * @param {*} debug Provide a message prefix to enable debugging.
 */
function makeOuterWebViewBridge<Root>(
  onRoot: (root: Root) => mixed,
  debug?: string
): WebViewCallbacks {
  let bridge: Bridge | void
  let gatedRoot: Root | void
  let webview: WebView | void

  // Gate the root object on the webview being ready:
  const tryReleasingRoot = () => {
    if (gatedRoot != null && webview != null) {
      onRoot(gatedRoot)
      gatedRoot = void 0
    }
  }

  // Feed incoming messages into the YAOB bridge (if any):
  const onMessage = event => {
    const message = JSON.parse(event.nativeEvent.data)
    if (debug != null) console.info(`${debug} →`, message)

    // This is a terrible hack. We are using our inside knowledge
    // of YAOB's message format to determine when the client has restarted.
    if (
      bridge != null &&
      message.events != null &&
      message.events.find(event => event.localId === 0)
    ) {
      bridge.close(new Error('edge-core: The WebView has been unmounted.'))
      bridge = void 0
    }

    // If we have no bridge, start one:
    if (bridge == null) {
      let firstMessage = true
      bridge = new Bridge({
        sendMessage: message => {
          if (debug != null) console.info(`${debug} ←`, message)
          if (webview == null) return

          const js = `if (window.bridge != null) {${
            firstMessage
              ? 'window.gotFirstMessage = true;'
              : 'window.gotFirstMessage && '
          } window.bridge.handleMessage(${JSON.stringify(message)})}`
          firstMessage = false
          webview.injectJavaScript(js)
        }
      })

      // Use our inside knowledge of YAOB to directly
      // subscribe to the root object appearing:
      onMethod.call(bridge._state, 'root', root => {
        gatedRoot = root
        tryReleasingRoot()
      })
    }

    // Finally, pass the message to the bridge:
    bridge.handleMessage(message)
  }

  // Listen for the webview component to mount:
  const setRef = element => {
    webview = element
    tryReleasingRoot()
  }

  return { onMessage, setRef }
}

/**
 * Launches the Edge core worker in a WebView and returns its API.
 */
export class EdgeCoreBridge extends Component<Props> {
  callbacks: WebViewCallbacks

  constructor(props: Props) {
    super(props)
    const { nativeIo = {}, debug = false } = props

    // Set up the native IO objects:
    const nativeIoPromise = makeClientIo().then(coreIo => {
      const bridgedIo = { 'edge-core': coreIo }
      for (const n in nativeIo) {
        bridgedIo[n] = bridgifyObject(nativeIo[n])
      }
      return bridgedIo
    })

    // Set up the YAOB bridge:
    this.callbacks = makeOuterWebViewBridge(
      (root: WorkerApi) => {
        nativeIoPromise
          .then(nativeIo => props.onLoad(nativeIo, root))
          .catch(error => props.onError(error))
      },
      debug ? 'edge-core' : void 0
    )
  }

  render() {
    let uri =
      Platform.OS === 'android'
        ? 'file:///android_asset/edge-core/index.html'
        : `file://${RNFS.MainBundlePath}/edge-core/index.html`
    if (this.props.debug) {
      uri += '?debug=true'
      console.log(`edge core at ${uri}`)
    }

    return (
      <View style={this.props.debug ? styles.debug : styles.hidden}>
        <WebView
          allowFileAccess
          onMessage={this.callbacks.onMessage}
          originWhitelist={['file://*']}
          ref={this.callbacks.setRef}
          source={{ uri }}
        />
      </View>
    )
  }
}

const styles = StyleSheet.create({
  debug: { height: 20, width: '100%' },
  hidden: { height: 0, width: 0 }
})
