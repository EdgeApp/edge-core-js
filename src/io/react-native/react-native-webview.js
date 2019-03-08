// @flow

import '../../client-side.js'

import React, { Component } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import RNFS from 'react-native-fs'
import { WebView } from 'react-native-webview'
import { Bridge, bridgifyObject } from 'yaob'

import { type EdgeNativeIo } from '../../types/types.js'
import { makeClientIo } from './react-native-io.js'
import { type WorkerApi } from './react-native-types.js'

type Props = {
  debug?: boolean,
  onError(e: Object): mixed,
  onLoad(nativeIo: EdgeNativeIo, root: WorkerApi): Promise<mixed>,
  nativeIo?: EdgeNativeIo
}

/**
 * Launches the Edge core worker in a WebView and returns its API.
 */
export class EdgeCoreBridge extends Component<Props> {
  onMessage: Function
  setWebview: Function

  constructor (props: Props) {
    super(props)
    const { nativeIo = {} } = props

    // Listen for the webview component to mount:
    let webview
    const webviewReady = new Promise(resolve => {
      this.setWebview = element => {
        console.log(
          'edge-core WebView.ref called with ' +
            (element == null ? 'null' : 'non-null')
        )
        webview = element
        if (element != null) resolve()
      }
    })

    // Create a yaob bridge:
    const bridge = new Bridge({
      sendMessage: message => {
        if (webview == null) {
          return setTimeout(() => {
            throw new Error('The edge-core worker has been unmounted.')
          }, 1000)
        }
        if (props.debug) console.info('edge-core ←', message)
        webview.injectJavaScript(
          `window.bridge.handleMessage(${JSON.stringify(message)})`
        )
      }
    })
    this.onMessage = event => {
      const message = JSON.parse(event.nativeEvent.data)
      if (props.debug) console.info('edge-core →', message)
      bridge.handleMessage(message)
    }

    // Fire our callback once everything is ready:
    Promise.all([makeClientIo(), bridge.getRoot(), webviewReady])
      .then(([coreIo, root]) => {
        nativeIo['edge-core'] = coreIo
        for (const n in nativeIo) bridgifyObject(nativeIo[n])
        return props.onLoad(nativeIo, root)
      })
      .catch(error => props.onError(error))
  }

  render () {
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
          onMessage={this.onMessage}
          originWhitelist={['file://*']}
          ref={this.setWebview}
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
