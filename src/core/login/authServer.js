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

function parseReply (json) {
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
    default:
      const message = json.message || json.detail || JSON.stringify(json)
      throw new Error(`Server error: ${message}`)
  }
}

export function authRequest (
  ai: ApiInput,
  method: string,
  path: string,
  body?: {}
) {
  const { state, io } = ai.props
  const { apiKey, uri } = state.login.server

  const opts: RequestOptions = {
    method: method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Token ' + apiKey
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
        io.console.info(
          `${method} ${fullUri} returned ${response.status} in ${time}ms`
        )
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
