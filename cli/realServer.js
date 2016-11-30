import {XMLHttpRequest} from 'xmlhttprequest'

let apiKey = null
try {
  apiKey = require('./apiKey.js').apiKey
} catch (e) { }

/**
 * Makes an HTTP request to the real auth server.
 */
export function authRequest (method, uri, body, callback) {
  // Ensure we have an API key:
  if (!apiKey) {
    const message = "Please create a file called 'bin/apiKey.js' with the line: " +
      "exports.apiKey = '<your key here>'"
    throw new Error(message)
  }

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
