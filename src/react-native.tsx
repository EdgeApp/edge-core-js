import { asObject, asString } from 'cleaners'
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
  EdgeLoginMessage,
  EdgeNativeIo,
  NetworkError
} from './types/types'
import { hmacSha256 } from './util/crypto/hashes'
import { utf8 } from './util/encoding'
import { timeout } from './util/promise'

export { makeFakeIo } from './core/fake/fake-io'
export * from './types/types'

function defaultOnError(error: unknown): void {
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
    airbitzSupport = false,
    apiKey,
    apiSecret,
    appId = '',
    authServer,
    changeServer,
    deviceDescription,
    hideKeys,
    infoServer,
    loginServer,
    logSettings,
    plugins,
    skipBlockHeight,
    syncServer
  } = props
  if (onLoad == null) {
    throw new TypeError('No onLoad passed to MakeEdgeContext')
  }

  return (
    <EdgeCoreBridge
      allowDebugging={allowDebugging}
      debug={debug}
      onError={onError}
      onLoad={async root => {
        const context = await root.makeEdgeContext(
          bridgifyNativeIo(nativeIo),
          bridgifyLogBackend({ crashReporter, onLog }),
          pluginUris,
          {
            airbitzSupport,
            apiKey,
            apiSecret,
            appId,
            authServer,
            changeServer,
            deviceDescription,
            hideKeys,
            infoServer,
            loginServer,
            logSettings,
            plugins,
            skipBlockHeight,
            syncServer
          }
        )
        await onLoad(context)
      }}
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
      onLoad={async root => {
        const fakeWorld = await root.makeFakeEdgeWorld(
          bridgifyNativeIo(nativeIo),
          bridgifyLogBackend({ crashReporter, onLog }),
          pluginUris,
          props.users
        )
        await onLoad(fakeWorld)
      }}
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

/** Just the parts of LoginStash that `fetchLoginMessages` needs. */
const asUsernameStash = asObject({
  loginId: asString,
  username: asString
})

/**
 * Fetches any login-related messages for all the users on this device.
 */
export async function fetchLoginMessages(
  apiKey: string,
  apiSecret?: Uint8Array
): Promise<EdgeLoginMessage[]> {
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
      const { username, loginId } = asUsernameStash(JSON.parse(text))
      loginMap[loginId] = username
    } catch (error: unknown) {}
  }

  const bodyText = JSON.stringify({ loginIds: Object.keys(loginMap) })

  // API key:
  let authorization = `Token ${apiKey}`
  if (apiSecret != null) {
    const requestText = `POST\n/api/v2/messages\n${bodyText}`
    const hash = hmacSha256(utf8.parse(requestText), apiSecret)
    authorization = `HMAC ${apiKey} ${base64.stringify(hash)}`
  }

  const uri = 'https://login.edge.app/api/v2/messages'
  const opts: EdgeFetchOptions = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization
    },
    body: JSON.stringify({ loginIds: Object.keys(loginMap) })
  }

  return await timeout(
    window.fetch(uri, opts),
    30000,
    new NetworkError('Could not reach the auth server: timeout')
  ).then(response => {
    if (!response.ok) {
      throw new Error(`${uri} return status code ${response.status}`)
    }

    return response.json().then(json => {
      const clean = asMessagesPayload(parseReply(json))
      const out: EdgeLoginMessage[] = []
      for (const message of clean) {
        const { loginId, ...rest } = message
        const id = base64.stringify(loginId)
        const username = loginMap[id]
        if (username == null) continue
        out.push({ ...rest, loginId: id, username })
      }
      return out
    })
  })
}
