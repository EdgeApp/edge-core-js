var abc = require('./abc.js')
var InnerContext = abc.Context

/**
 * Injects HTTP and web-storage powers into the Context object
 */
function Context (apiKey) {
  function authRequest (method, uri, body, callback) {
    var xhr = new window.XMLHttpRequest()
    xhr.addEventListener('load', function () {
      callback(null, this.status, this.responseText)
    })
    xhr.addEventListener('error', function () {
      callback(Error('Cannot reach auth server'))
    })
    xhr.open(method, uri)
    xhr.setRequestHeader('Authorization', 'Token ' + apiKey)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send(JSON.stringify(body))
    console.log('Visit ' + uri)
  }

  return new InnerContext(authRequest, window.localStorage)
}
abc.Context = Context
module.exports = abc
