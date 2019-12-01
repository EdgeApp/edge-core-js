import { StoreEnhancer } from 'redux'
import { Bridge } from 'yaob'

interface EnhancerOptions {
  name?: string
}

declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION__?: (config?: EnhancerOptions) => StoreEnhancer

    /**
     * Plugins call this to register themselves with the core.
     * We call `lockEdgeCorePlugins` ourselves on React Native.
     */
    addEdgeCorePlugins?: (plugins: any) => void

    /**
     * Native code calls this bridge to pass back results from IO methods.
     */
    nativeBridge: any

    /**
     * Native code calls this bridge to pass in messages from React Native.
     */
    reactBridge: Bridge

    /**
     * Our Java code injects this into the Android WebView,
     * allowing JavaScript to talk to native code.
     */
    edgeCore: {
      /**
       * Sends a message to the React Native component.
       */
      postMessage: (message: unknown) => void

      /**
       * Calls a native IO method.
       */
      call: (id: number, name: string, args: string) => void
    }

    /**
     * Our Swift code installs this message handler into the iOS WebView,
     * allowing JavaScript to talk to native code.
     */
    webkit: {
      messageHandlers: {
        edgeCore: {
          postMessage: (args: [number, string, unknown[]]) => void
        }
      }
    }
  }
}
