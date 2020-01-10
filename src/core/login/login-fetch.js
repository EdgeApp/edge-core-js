// @flow

import {
  type EdgeFetchOptions,
  NetworkError,
  ObsoleteApiError,
  OtpError,
  PasswordError,
  UsernameError
} from '../../types/types.js'
import { timeout } from '../../util/promise.js'
import { type ApiInput } from '../root-pixie.js'

export function parseReply(json: Object) {
  switch (json.status_code) {
    case 0: // Success
      return json.results

    case 2: // Account exists
      throw new UsernameError('Account already exists on server')

    case 3: // Account does not exist
      throw new UsernameError('Account does not exist on server')

    case 4: // Invalid password
    case 5: // Invalid answers
      throw new PasswordError(json.results)

    case 6: // Invalid API key
      throw new Error('Invalid API key')

    case 8: // Invalid OTP
      throw new OtpError(json.results)

    case 1000: // Endpoint obsolete
      throw new ObsoleteApiError()

    case 1: // Error
    case 7: // Pin expired
    default: {
      const message = json.message || json.detail || JSON.stringify(json)
      throw new Error(`Server error: ${message}`)
    }
  }
}

export function loginFetch(
  ai: ApiInput,
  method: string,
  path: string,
  body?: {}
): Promise<any> {
  const { state, io, log } = ai.props
  const { apiKey, serverUri } = state.login

  const opts: EdgeFetchOptions = {
    method: method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Token ${
        apiKey === '' ? '4248c1bf41e53b840a5fdb2c872dd3ade525e66d' : apiKey
      }`
    }
  }
  if (method !== 'GET') {
    opts.body = JSON.stringify(body)
  }

  const start = Date.now()
  const fullUri = serverUri + path
  return timeout(io.fetch(fullUri, opts), 30000).then(
    response => {
      const time = Date.now() - start
      log(`${method} ${fullUri} returned ${response.status} in ${time}ms`)
      return response.json().then(parseReply, jsonError => {
        throw new Error('Non-JSON reply, HTTP status ' + response.status)
      })
    },
    networkError => {
      const time = Date.now() - start
      log(`${method} ${fullUri} failed in ${time}ms, ${String(networkError)}`)
      throw new NetworkError(`Could not reach the auth server: ${path}`)
    }
  )
}
