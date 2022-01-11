// @flow

import { makeReactNativeDisklet } from 'disklet'
import * as React from 'react'
import { base64 } from 'rfc4648'
import { bridgifyObject } from 'yaob'

import { type LogBackend, defaultOnLog } from './core/log/log.js'
import { parseReply } from './core/login/login-fetch.js'
import { EdgeCoreBridge } from './io/react-native/react-native-webview.js'
import {
  type EdgeContextProps,
  type EdgeFakeWorldProps
} from './types/exports.js'
import { asMessagesPayload } from './types/server-cleaners.js'
import {
  type EdgeFetchOptions,
  type EdgeLoginMessages,
  type EdgeNativeIo,
  NetworkError
} from './types/types.js'
import { timeout } from './util/promise.js'

export { makeFakeIo } from './core/fake/fake-io.js'
export * from './types/types.js'

function onErrorDefault(e: any): void {
  console.error(e)
}

let warningShown = false

export function MakeEdgeContext(props: EdgeContextProps): React.Node {
  const {
    allowDebugging,
    coreServerUrl,
    debug,
    nativeIo,
    pluginUris = [],
    onError = onErrorDefault,
    onLoad,
    ...rest
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeEdgeContext')
  }
  if (props.options != null && !warningShown) {
    warningShown = true
    console.warn(
      'The MakeEdgeContext options prop is deprecated - just pass the context options as normal props.'
    )
  }
  const options = { ...props.options, ...rest }
  const { crashReporter, onLog = defaultOnLog } = options

  return (
    <EdgeCoreBridge
      allowDebugging={allowDebugging}
      coreServerUrl={coreServerUrl}
      debug={debug}
      onError={onError}
      onLoad={(clientIo, root) =>
        root
          .makeEdgeContext(
            clientIo,
            bridgifyNativeIo(nativeIo),
            bridgifyLogBackend({ crashReporter, onLog }),
            pluginUris,
            options
          )
          .then(onLoad)
      }
    />
  )
}

export function MakeFakeEdgeWorld(props: EdgeFakeWorldProps): React.Node {
  const {
    allowDebugging,
    coreServerUrl,
    crashReporter,
    debug,
    nativeIo,
    pluginUris = [],

    onError = onErrorDefault,
    onLoad,
    onLog = defaultOnLog
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeFakeEdgeWorld')
  }

  return (
    <EdgeCoreBridge
      allowDebugging={allowDebugging}
      coreServerUrl={coreServerUrl}
      debug={debug}
      onError={onError}
      onLoad={(clientIo, root) =>
        root
          .makeFakeEdgeWorld(
            clientIo,
            bridgifyNativeIo(nativeIo),
            bridgifyLogBackend({ crashReporter, onLog }),
            pluginUris,
            props.users
          )
          .then(onLoad)
      }
    />
  )
}

function bridgifyNativeIo(nativeIo: EdgeNativeIo = {}): EdgeNativeIo {
  const out: EdgeNativeIo = {}
  for (const key of Object.keys(nativeIo)) {
    out[key] = bridgifyObject(nativeIo[key])
  }
  return out
}

function bridgifyLogBackend(backend: LogBackend): LogBackend {
  if (backend.crashReporter != null) bridgifyObject(backend.crashReporter)
  return bridgifyObject(backend)
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
      authorization: `Token ${apiKey}`
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
      const clean = asMessagesPayload(parseReply(json))
      const out: EdgeLoginMessages = {}
      for (const message of clean) {
        const { loginId, ...rest } = message
        const id = base64.stringify(loginId)
        const username = loginMap[id]
        if (username != null) out[username] = { ...rest, loginId: id }
      }
      return out
    })
  })
}
