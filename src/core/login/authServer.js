// @flow

import {
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

export function authRequest(
  ai: ApiInput,
  method: string,
  path: string,
  body?: {}
) {
  const { state, io, log } = ai.props
  const { apiKey, uri } = state.login.server

  const opts: RequestOptions = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Token ${
        apiKey === '' ? '4248c1bf41e53b840a5fdb2c872dd3ade525e66d' : apiKey
      }`
    }
  }
  if (method !== 'GET') {
    opts.body = JSON.stringify(body)
  }

  const start = Date.now()
  const fullUri = uri + path
  return timeout(
    io.fetch(fullUri, opts).then(
      response => {
        const time = Date.now() - start
        log(`${method} ${fullUri} returned ${response.status} in ${time}ms`)
        return response.json().then(parseReply, jsonError => {
          throw new Error('Non-JSON reply, HTTP status ' + response.status)
        })
      },
      networkError => {
        throw new NetworkError(`Could not reach the auth server: ${path}`)
      }
    ),
    30000,
    new NetworkError('Could not reach the auth server: timeout')
  )
}
