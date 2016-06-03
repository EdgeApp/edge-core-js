/* global describe, it */
var abc = require('../src/abc.js')
var assert = require('assert')
var FakeStorage = require('./fake/fakeStorage.js').FakeStorage
var FakeServer = require('./fake/fakeServer.js').FakeServer
var realServer = require('./fake/realServer.js')

describe('username', function () {
  it('normalize spaces and capitalization', function () {
    assert.equal('test test', abc.usernameFix('  TEST TEST  '))
  })
  it('reject invalid characters', function () {
    assert.throws(function () { abc.usernameFix('テスト') })
  })
})

describe('creation', function () {
  it('username available', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()

    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    ctx.usernameAvailable('js test 1', done)
  })

  it('username not available', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populateUsers()
    var fakeServer = new FakeServer()

    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    ctx.usernameAvailable('js test 0', function (err) { done(!err) })
  })

  it.skip('username not available on live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populateUsers()

    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    ctx.usernameAvailable('js test 0', function (err) { done(!err) })
  })

  it.skip('username available on live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()

    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    ctx.usernameAvailable('js test dontcreate', done)
  })

  it('create account', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()

    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    ctx.accountCreate('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) return done(err)
      // Try logging in:
      ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', done)
    })
  })
})

describe('password', function () {
  it('login offline', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()

    var ctx = new abc.Context(null, fakeStorage)
    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', done)
  })

  it('login online', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    fakeServer.populate()

    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', done)
  })

  it.skip('login to live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()

    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', done)
  })
})

describe('pin', function () {
  it('login', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()

    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    ctx.pinLogin('js test 0', '1234', done)
  })

  it('setup', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()

    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) done(err)
      account.pinSetup('1234', function (err) {
        if (err) done(err)
        ctx.pinLogin('js test 0', '1234', done)
      })
    })
  })

  it.skip('login to live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()

    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    ctx.pinLogin('js test 0', '1234', done)
  })

  it.skip('setup on live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()

    // If we don't remove this, `pinAuthId` will be reused,
    // breaking the package used by the "login to live server" test:
    fakeStorage.removeItem('airbitz.user.js test 0.pinAuthId')

    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) return done(err)
      account.pinSetup('1234', function (err) {
        if (err) return done(err)
        ctx.pinLogin('js test 0', '1234', done)
      })
    })
  })
})
