import {XMLHttpRequest} from 'xmlhttprequest'

/**
 * Makes an HTTP request to the real auth server.
 */
export function makeAuthRequest (apiKey) {
  return function authRequest (method, uri, body, callback) {
    const xhr = new XMLHttpRequest()
    xhr.addEventListener('load', function () {
      callback(null, this.status, this.responseText)
    })
    xhr.addEventListener('error', function () {
      callback(Error('Cannot reach auth server'))
    })
    xhr.open(method, uri)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', 'Token ' + apiKey)
    xhr.send(JSON.stringify(body))
    console.log(method + ' ' + uri)
  }
}
