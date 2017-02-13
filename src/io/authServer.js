import * as error from '../error.js'
import {timeout} from '../util/promise.js'

const serverRoot = 'https://auth.airbitz.co/api'
// const serverRoot = 'https://test-auth.airbitz.co/api'

function parseReply (json) {
  switch (json['status_code']) {
    case 0: // Success
      return json['results']

    case 2: // Account exists
      throw new error.UsernameError('Account already exists on server')

    case 3: // Account does not exist
      throw new error.UsernameError('Account does not exist on server')

    case 4: // Invalid password
    case 5: // Invalid answers
      throw new error.PasswordError(json['results'])

    case 6: // Invalid API key
      throw new Error('Invalid API key')

    case 8: // Invalid OTP
      throw new error.OtpError(json['results'])

    case 1000: // Endpoint obsolete
      throw new error.ObsoleteApiError()

    case 1: // Error
    case 7: // Pin expired
    default:
      const message = json['message'] || json['detail'] || JSON.stringify(json)
      throw new Error(`Server error: ${message}`)
  }
}

export class AuthServer {
  constructor (io, apiKey) {
    // if (!apiKey) throw new TypeError('No API key provided')

    this.io = io
    this.apiKey = apiKey
  }

  /**
   * Wraps the raw `fetch` API with the headers and error processing needed
   * to talk to the auth server.
   * @param body JSON object to send
   * @return a promise of the server's JSON reply
   */
  request (method, uri, body) {
    const opts = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + this.apiKey
      }
    }
    if (method !== 'GET') {
      opts.body = JSON.stringify(body)
    }

    this.io.log.info(`auth: ${method} ${uri}`)
    return timeout(this.io.fetch(serverRoot + uri, opts).then(response => {
      return response.json().then(parseReply, jsonError => {
        throw new Error('Non-JSON reply, HTTP status ' + response.status)
      })
    }, networkError => {
      throw new error.NetworkError('Could not reach the auth server')
    }), 10000, new error.NetworkError('Could not reach the auth server: timeout'))
  }
}
