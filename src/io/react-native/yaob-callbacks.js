// @flow

import '../../client-side.js'

import { findNodeHandle, UIManager } from 'react-native'
import { Bridge, onMethod } from 'yaob'

import {
  type EdgeCoreMessageEvent,
  type EdgeCoreWebView
} from './react-native-types.js'

export type YaobCallbacks = {
  handleMessage: (event: EdgeCoreMessageEvent) => void,
  setRef: (element: EdgeCoreWebView | null) => void
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
export function makeYaobCallbacks<Root>(
  onRoot: (root: Root) => mixed,
  debug?: string
): YaobCallbacks {
  let bridge: Bridge | void
  let gatedRoot: Root | void
  let webview: EdgeCoreWebView | null = null

  // Gate the root object on the WebView being ready:
  function tryReleasingRoot(): void {
    if (gatedRoot != null && webview != null) {
      onRoot(gatedRoot)
      gatedRoot = undefined
    }
  }

  // Feed incoming messages into the YAOB bridge (if any):
  function handleMessage(event: EdgeCoreMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.message)
    if (debug != null) console.info(`${debug} →`, message)

    // This is a terrible hack. We are using our inside knowledge
    // of YAOB's message format to determine when the client has restarted.
    if (
      bridge != null &&
      message.events != null &&
      message.events.find(event => event.localId === 0) != null
    ) {
      bridge.close(new Error('edge-core: The WebView has been unmounted.'))
      bridge = undefined
    }

    // If we have no bridge, start one:
    if (bridge == null) {
      let firstMessage = true
      bridge = new Bridge({
        sendMessage: message => {
          if (debug != null) console.info(`${debug} ←`, message)
          if (webview == null) return

          const js = `if (window.reactBridge != null) {${
            firstMessage
              ? 'window.reactBridge.inSync = true;'
              : 'window.reactBridge.inSync && '
          } window.reactBridge.handleMessage(${JSON.stringify(message)})}`
          firstMessage = false

          if (webview.runJs == null) {
            // Android version:
            UIManager.dispatchViewManagerCommand(
              findNodeHandle(webview),
              'runJs',
              [js]
            )
          } else {
            webview.runJs(js)
          }
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

  // Listen for the WebView component to mount:
  function setRef(element: EdgeCoreWebView | null): void {
    webview = element
    tryReleasingRoot()
  }

  return { handleMessage, setRef }
}
