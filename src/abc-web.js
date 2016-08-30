var abc = require('./abc.js')
var InnerContext = abc.Context

/**
 * Injects HTTP and web-storage powers into the Context object
 */
function Context (apiKey, accountType) {
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

  return new InnerContext(authRequest, window.localStorage, accountType)
}
abc.Context = Context

/**
 * Creates a context object.
 */
abc.makeABCContext = function makeContext (opts) {
  return new abc.Context(opts.apiKey, opts.type)
}

module.exports = abc
