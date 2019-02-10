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
  bridge: Bridge
  ref: Object
  root: WorkerApi

  constructor (props: Props) {
    super(props)
    this.ref = React.createRef()

    this.bridge = new Bridge({
      sendMessage: message =>
        this.ref.current.injectJavaScript(
          `window.bridge.handleMessage(${JSON.stringify(message)})`
        )
    })

    const { nativeIo = {} } = props
    Promise.all([makeClientIo(), this.bridge.getRoot()])
      .then(([coreIo, root]) => {
        nativeIo['edge-core'] = coreIo
        for (const n in nativeIo) bridgifyObject(nativeIo[n])

        this.root = root
        return props.onLoad(nativeIo, root)
      })
      .catch(error => props.onError(error))
  }

  componentWillUnmount () {
    if (this.root) this.root.closeEdge()
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
          onMessage={event => {
            const message = JSON.parse(event.nativeEvent.data)
            if (this.props.debug) console.info(message)
            this.bridge.handleMessage(message)
          }}
          originWhitelist={['file://*']}
          ref={this.ref}
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
