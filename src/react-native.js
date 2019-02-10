// @flow

import React from 'react'

import { EdgeCoreBridge } from './io/react-native/react-native-webview.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeNativeIo
} from './types/types.js'

export { makeFakeIo } from './core/core.js'
export * from './types/types.js'

function onErrorDefault (e: any): mixed {
  console.error(e)
}

export function MakeEdgeContext (props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (context: EdgeContext) => mixed,
  options: EdgeContextOptions
}) {
  const { onError = onErrorDefault, onLoad } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeEdgeContext')
  }

  return (
    <EdgeCoreBridge
      debug={props.debug}
      nativeIo={props.nativeIo}
      onError={error => onError(error)}
      onLoad={(nativeIo, root) =>
        root.makeEdgeContext(nativeIo, props.options).then(onLoad)
      }
    />
  )
}

export function MakeFakeEdgeWorld (props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (world: EdgeFakeWorld) => mixed,
  users?: Array<EdgeFakeUser>
}) {
  const { onError = onErrorDefault, onLoad } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeFakeEdgeWorld')
  }

  return (
    <EdgeCoreBridge
      debug={props.debug}
      nativeIo={props.nativeIo}
      onError={error => onError(error)}
      onLoad={(nativeIo, root) =>
        root.makeFakeEdgeWorld(nativeIo, props.users).then(onLoad)
      }
    />
  )
}
