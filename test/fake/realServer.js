var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest
var apiKey = {}
try {
  apiKey = require('./apiKey.js')
} catch (e) { }

/**
 * Makes an HTTP request to the real auth server.
 */
function authRequest (method, uri, body, callback) {
  // Ensure we have an API key:
  if (!apiKey.apiKey) {
    var message = "Please create a file called 'test/fake/apiKey.js' with the line: " +
      "module.exports.apiKey = '<your key here>'"
    throw Error(message)
  }

  var xhr = new XMLHttpRequest()
  xhr.addEventListener('load', function () {
    callback(null, this.status, this.responseText)
  })
  xhr.addEventListener('error', function () {
    callback(Error('Cannot reach auth server'))
  })
  xhr.open('POST', uri)
  xhr.setRequestHeader('Content-Type', 'application/json')
  xhr.setRequestHeader('Authorization', 'Token ' + apiKey)
  xhr.send(JSON.stringify(body))
  console.log('Visit ' + uri)
}
exports.authRequest = authRequest
