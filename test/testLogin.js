/* global describe, it */
var abc = require('../src/abc.js')
var Account = require('../src/account.js').Account
var assert = require('assert')
var Login = require('../src/login/login.js')
var packages = require('./fake/packages.js')
var FakeStorage = require('./fake/fakeStorage.js').FakeStorage
var FakeServer = require('./fake/fakeServer.js').FakeServer

function testAccount (ctx) {
  var login = Login.offline(ctx.localStorage, 'js test 0', packages.dataKey)
  return new Account(ctx, login)
}

describe('login', function () {
  it('find repo', function () {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)
    var login = Login.offline(ctx.localStorage, 'js test 0', packages.dataKey)

    assert.ok(login.accountFind('account:repo:co.airbitz.wallet'))
    assert.throws(function () {
      login.accountFind('account:repo:blah')
    })
  })

  it('attach repo', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    var login = Login.offline(ctx.localStorage, 'js test 0', packages.dataKey)

    var info = {
      dataKey: 'fa57',
      syncKey: 'f00d'
    }
    login.accountAttach(ctx, 'account:repo:test', info, function (err) {
      if (err) return done(err)
      assert.deepEqual(login.accountFind('account:repo:test'), info)
      done()
    })
  })
})

describe('username', function () {
  it('normalize spaces and capitalization', function () {
    assert.equal('test test', abc.usernameFix('  TEST TEST  '))
  })

  it('reject invalid characters', function () {
    assert.throws(function () { abc.usernameFix('テスト') })
  })

  it('list usernames in local storage', function () {
    var fakeStorage = new FakeStorage()
    fakeStorage.populateUsers()
    var ctx = new abc.Context(null, fakeStorage)

    assert.deepEqual(ctx.usernameList(), ['js test 0'])
  })
})

describe('creation', function () {
  it('username available', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.usernameAvailable('js test 1', done)
  })

  it('username not available', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populateUsers()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.usernameAvailable('js test 0', function (err) { done(!err) })
  })

  it('create account', function (done) {
    this.timeout(9000)
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage, 'account:repo:test')

    ctx.createAccount('js test 0', 'y768Mv4PLFupQjMu', '1234', function (err, account) {
      if (err) return done(err)
      // Try logging in:
      ctx.loginWithPassword('js test 0', 'y768Mv4PLFupQjMu', null, null, done)
    })
  })
})

describe('password', function () {
  it('setup', function (done) {
    this.timeout(9000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    var account = testAccount(ctx)

    account.passwordSetup('Test1234', function (err) {
      if (err) return done(err)
      ctx.localStorage.clear() // Force server-based login
      ctx.loginWithPassword('js test 0', 'Test1234', null, null, done)
    })
  })

  it('check good', function () {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)
    var account = testAccount(ctx)

    assert(account.passwordOk('y768Mv4PLFupQjMu'))
  })

  it('check bad', function () {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)
    var account = testAccount(ctx)

    assert(!account.passwordOk('wrong one'))
  })

  it('login offline', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)

    ctx.loginWithPassword('js test 0', 'y768Mv4PLFupQjMu', null, null, done)
  })

  it('login online', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.loginWithPassword('js test 0', 'y768Mv4PLFupQjMu', null, null, done)
  })
})

describe('pin', function () {
  it('exists', function () {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()

    var ctx = new abc.Context(null, fakeStorage)
    assert.equal(ctx.pinExists('js test 0'), true)
  })

  it('does not exist', function () {
    var fakeStorage = new FakeStorage()

    var ctx = new abc.Context(null, fakeStorage)
    assert.equal(ctx.pinExists('js test 0'), false)
  })

  it('login', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.loginWithPIN('js test 0', '1234', done)
  })

  it('setup', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    var account = testAccount(ctx)

    account.pinSetup('1234', function (err) {
      if (err) return done(err)
      ctx.loginWithPIN('js test 0', '1234', done)
    })
  })
})

describe('recovery2', function () {
  it('get local key', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)

    ctx.getRecovery2Key('js test 0', function (err, key) {
      if (err) return done(err)
      assert.equal(key, packages.recovery2Key)
      done()
    })
  })

  it('get questions', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.fetchRecovery2Questions(packages.recovery2Key, 'js test 0', function (err, questions) {
      if (err) return done(err)
      assert.equal(questions.length, packages.recovery2Questions.length)
      for (var i = 0; i < questions.length; ++i) {
        assert.equal(questions[i], packages.recovery2Questions[i])
      }
      done()
    })
  })

  it('login', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.loginWithRecovery2(packages.recovery2Key, 'js test 0', packages.recovery2Answers, null, null, done)
  })

  it('set', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    var account = testAccount(ctx)

    account.recovery2Set(packages.recovery2Questions, packages.recovery2Answers, function (err, key) {
      if (err) return done(err)
      ctx.fetchRecovery2Questions(key, 'js test 0', function (err, questions) {
        if (err) return done(err)
        ctx.loginWithRecovery2(key, 'js test 0', packages.recovery2Answers, null, null, done)
      })
    })
  })
})
