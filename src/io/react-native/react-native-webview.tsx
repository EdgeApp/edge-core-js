import '../../client-side'

import * as React from 'react'
import { requireNativeComponent } from 'react-native'

import { EdgeCoreWebView, WorkerApi } from './react-native-types'
import { makeYaobCallbacks, YaobCallbacks } from './yaob-callbacks'

interface Props {
  allowDebugging?: boolean
  debug?: boolean
  onError: (error: unknown) => void
  onLoad: (root: WorkerApi) => Promise<void>
}

/**
 * Launches the Edge core worker in a WebView and returns its API.
 */
export class EdgeCoreBridge extends React.Component<Props> {
  callbacks: YaobCallbacks

  constructor(props: Props) {
    super(props)
    const { onError, onLoad } = props

    // Set up the YAOB bridge:
    this.callbacks = makeYaobCallbacks((root: WorkerApi) => {
      onLoad(root).catch(onError)
    })
  }

  render(): JSX.Element {
    const { allowDebugging = false, debug = false, onError } = this.props

    return (
      <NativeWebView
        ref={this.callbacks.setRef}
        allowDebugging={debug || allowDebugging}
        source={debug ? 'http://localhost:8080/' : null}
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

const NativeWebView: EdgeCoreWebView = requireNativeComponent('EdgeCoreWebView')
