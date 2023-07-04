import '../../client-side'

import { findNodeHandle, UIManager } from 'react-native'
import { Bridge, onMethod } from 'yaob'

import { hideProperties } from '../hidden-properties'
import { EdgeCoreMessageEvent, EdgeCoreWebViewRef } from './react-native-types'

export interface YaobCallbacks {
  handleMessage: (event: EdgeCoreMessageEvent) => void
  setRef: (element: EdgeCoreWebViewRef | null) => void
}

const DEBUG_SIZE = 240
const CALLS_COUNT = 10
let numCalls = 0
const calls: number[] = []

function trackCallbacks(debug: string, message: string): void {
  const date = new Date().getTime()
  const time = new Date(date).toISOString().split('T')[1]
  calls[numCalls] = date
  numCalls++

  let callsPerSec = 0

  if (numCalls >= 10) {
    const prevDate = calls[numCalls - CALLS_COUNT]
    const splitMs = date - prevDate
    callsPerSec = CALLS_COUNT / (splitMs / 1000)
  }

  console.info(
    `${time} cps=${callsPerSec.toFixed(3)} size=${
      message.length
    } ${debug} ${message.slice(0, DEBUG_SIZE)}`
  )
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
  onRoot: (root: Root) => unknown,
  debug: string = 'YAOBCALLBACK'
): YaobCallbacks {
  let bridge: Bridge | undefined
  let gatedRoot: Root | undefined
  let webview: EdgeCoreWebViewRef | null = null

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
    if (debug != null) trackCallbacks(`${debug} →`, event.nativeEvent.message)

    // This is a terrible hack. We are using our inside knowledge
    // of YAOB's message format to determine when the client has restarted.
    if (
      bridge != null &&
      message.events != null &&
      message.events.find((event: any) => event.localId === 0) != null
    ) {
      bridge.close(new Error('edge-core: The WebView has been unmounted.'))
      bridge = undefined
    }

    // If we have no bridge, start one:
    if (bridge == null) {
      let firstMessage = true
      bridge = new Bridge({
        hideProperties,
        sendMessage: message => {
          const msgText = JSON.stringify(message)

          if (debug != null) trackCallbacks(`${debug} ←`, msgText)

          if (webview == null) return

          const js = `if (window.reactBridge != null) {${
            firstMessage
              ? 'window.reactBridge.inSync = true;'
              : 'window.reactBridge.inSync && '
          } window.reactBridge.handleMessage(${JSON.stringify(message)})}`
          firstMessage = false

          UIManager.dispatchViewManagerCommand(
            findNodeHandle(webview),
            'runJs',
            [js]
          )
        }
      })

      // Use our inside knowledge of YAOB to directly
      // subscribe to the root object appearing:
      // @ts-expect-error
      onMethod.call(bridge._state, 'root', root => {
        gatedRoot = root
        tryReleasingRoot()
      })
    }

    // Finally, pass the message to the bridge:
    bridge.handleMessage(message)
  }

  // Listen for the WebView component to mount:
  function setRef(element: EdgeCoreWebViewRef | null): void {
    webview = element
    tryReleasingRoot()
  }

  return { handleMessage, setRef }
}
