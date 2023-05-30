import { makeReactNativeDisklet } from 'disklet'
import * as React from 'react'
import { base64 } from 'rfc4648'
import { bridgifyObject } from 'yaob'

import { defaultOnLog, LogBackend } from './core/log/log'
import { parseReply } from './core/login/login-fetch'
import { EdgeCoreBridge } from './io/react-native/react-native-webview'
import { EdgeContextProps, EdgeFakeWorldProps } from './types/exports'
import { asMessagesPayload } from './types/server-cleaners'
import {
  EdgeFetchOptions,
  EdgeLoginMessages,
  EdgeNativeIo,
  NetworkError
} from './types/types'
import { timeout } from './util/promise'

export { makeFakeIo } from './core/fake/fake-io'
export * from './types/types'

function defaultOnError(error: any): void {
  console.error(error)
}

export function MakeEdgeContext(props: EdgeContextProps): JSX.Element {
  const {
    allowDebugging,
    crashReporter,
    debug,
    nativeIo,
    pluginUris = [],
    onError = defaultOnError,
    onLoad,
    onLog = defaultOnLog,

    // Inner context options:
    apiKey = '',
    appId = '',
    authServer,
    deviceDescription,
    hideKeys,
    logSettings,
    plugins
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeEdgeContext')
  }

  return (
    <EdgeCoreBridge
      allowDebugging={allowDebugging}
      debug={debug}
      onError={onError}
      onLoad={(clientIo, root) =>
        root
          .makeEdgeContext(
            clientIo,
            bridgifyNativeIo(nativeIo),
            bridgifyLogBackend({ crashReporter, onLog }),
            pluginUris,
            {
              apiKey,
              appId,
              authServer,
              deviceDescription,
              hideKeys,
              logSettings,
              plugins
            }
          )
          .then(onLoad)
      }
    />
  )
}

export function MakeFakeEdgeWorld(props: EdgeFakeWorldProps): JSX.Element {
  const {
    allowDebugging,
    crashReporter,
    debug,
    nativeIo,
    pluginUris = [],

    onError = defaultOnError,
    onLoad,
    onLog = defaultOnLog
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeFakeEdgeWorld')
  }

  return (
    <EdgeCoreBridge
      allowDebugging={allowDebugging}
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
    } catch (error: any) {}
  }

  const uri = 'https://login.edge.app/api/v2/messages'
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
        if (username == null) continue
        out[username] = { ...rest, loginId: id, username }
      }
      return out
    })
  })
}
