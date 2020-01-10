// @flow

import { makeReactNativeDisklet } from 'disklet'
import React from 'react'

import { parseReply } from './core/login/login-fetch.js'
import { EdgeCoreBridge } from './io/react-native/react-native-webview.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFetchOptions,
  type EdgeLoginMessages,
  type EdgeNativeIo,
  NetworkError
} from './types/types.js'
import { timeout } from './util/promise.js'

export { makeFakeIo } from './core/fake/fake-io.js'
export * from './types/types.js'

function onErrorDefault(e: any): mixed {
  console.error(e)
}

export function MakeEdgeContext(props: {
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

export function MakeFakeEdgeWorld(props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (world: EdgeFakeWorld) => mixed,
  users?: EdgeFakeUser[]
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

/**
 * Fetches any login-related messages for all the users on this device.
 */
export async function fetchLoginMessages(
  apiKey: string
): Promise<EdgeLoginMessages> {
  const disklet = makeReactNativeDisklet()

  // Load the login stashes from disk:
  const loginMap: { [loginId: string]: string } = {} // loginId -> username
  const listing = await disklet.list('logins')
  const files: string[] = await Promise.all(
    Object.keys(listing)
      .filter(path => listing[path] === 'file')
      .map(path => disklet.getText(path).catch(() => '{}'))
  )
  for (const text of files) {
    try {
      const { username, loginId } = JSON.parse(text)
      if (loginId == null || username == null) continue
      loginMap[loginId] = username
    } catch (e) {}
  }

  const uri = 'https://auth.airbitz.co/api/v2/messages'
  const opts: EdgeFetchOptions = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Token ' + apiKey
    },
    body: JSON.stringify({ loginIds: Object.keys(loginMap) })
  }

  return timeout(
    window.fetch(uri, opts),
    30000,
    new NetworkError('Could not reach the auth server: timeout')
  ).then(response => {
    if (!response.ok) {
      throw new Error(`${uri} return status code ${response.status}`)
    }

    return response.json().then(json => {
      const reply = parseReply(json)
      const out = {}
      for (const message of reply) {
        const username = loginMap[message.loginId]
        if (username) out[username] = message
      }
      return out
    })
  })
}
