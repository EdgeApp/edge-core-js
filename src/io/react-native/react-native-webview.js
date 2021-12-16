// @flow

import '../../client-side.js'

import * as React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import RNFS from 'react-native-fs'
import { WebView } from 'react-native-webview'

import { makeClientIo } from './react-native-io.js'
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
    const clientIoPromise = makeClientIo()

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
