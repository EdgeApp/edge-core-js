var FakeServer = require('./fakeServer.js').FakeServer
var FakeStorage = require('./fakeStorage.js').FakeStorage
var packages = require('./packages.js')

var abc = require('../../src/abc.js')
var Account = require('../../src/account.js').Account
var Login = require('../../src/login/login.js')

function makeSession (opts) {
  var session = {}

  // Expand needs flags:
  opts.needsLogin |= opts.needsAccount
  opts.needsContext |= opts.needsLogin

  if (opts.needsContext) {
    session.storage = new FakeStorage()
    session.server = new FakeServer()
    session.context = new abc.Context({
      localStorage: session.storage,
      authRequest: session.server.bindRequest(),
      accountType: opts.accountType
    })
  }

  if (opts.needsLogin) {
    session.storage.populate()
    session.login = Login.offline(session.storage, 'js test 0', packages.dataKey)
  }

  if (opts.needsAccount) {
    session.account = new Account(session.context, session.login)
  }

  return session
}
exports.makeSession = makeSession
