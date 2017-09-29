// @flow
import {
  NetworkError,
  ObsoleteApiError,
  OtpError,
  PasswordError,
  UsernameError
} from '../../error.js'
import { timeout } from '../../util/promise.js'
import type { CoreRoot } from '../root.js'

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
  coreRoot: CoreRoot,
  method: string,
  path: string,
  body?: {}
) {
  const opts: RequestOptions = {
    method: method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Token ' + coreRoot.apiKey
    }
  }
  if (method !== 'GET') {
    opts.body = JSON.stringify(body)
  }

  const uri = coreRoot.authServer + path
  coreRoot.io.console.info(`${method} ${uri}`)
  return timeout(
    coreRoot.io.fetch(uri, opts).then(
      response =>
        response.json().then(parseReply, jsonError => {
          throw new Error('Non-JSON reply, HTTP status ' + response.status)
        }),
      networkError => {
        throw new NetworkError('Could not reach the auth server')
      }
    ),
    10000,
    new NetworkError('Could not reach the auth server: timeout')
  )
}
