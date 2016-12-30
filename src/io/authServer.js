const serverRoot = 'https://auth.airbitz.co/api'
// const serverRoot = 'https://test-auth.airbitz.co/api'

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
    const headers = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + this.apiKey
      }
    }
    if (method !== 'GET') {
      headers.body = JSON.stringify(body)
    }

    return this.io.fetch(serverRoot + uri, headers).then(response => {
      return response.json().then(json => {
        if (json['status_code'] !== 0) {
          throw new Error('Server error ' + JSON.stringify(json))
        }
        return json['results']
      }, jsonError => {
        throw new Error('Non-JSON reply, HTTP status ' + response.status)
      })
    }, networkError => {
      throw new Error('NetworkError: Could not connect to auth server')
    })
  }
}
