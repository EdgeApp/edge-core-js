/* global describe, it */
var abc = require('../src/abc.js')
var Account = require('../src/account.js').Account
var assert = require('assert')
var packages = require('./fake/packages.js')
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
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    ctx.accountCreate('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) return done(err)
      // Try logging in:
      ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', done)
    })
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

  it.skip('create account on live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    var ctx = new abc.Context(realServer.authRequest, fakeStorage)

    ctx.accountCreate('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) return done(err)
      // Try logging in:
      ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', done)
    })
  })
})

describe('password', function () {
  it('setup', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    fakeServer.populate()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    var account = new Account(ctx, 'js test 0', packages.dataKey)

    account.passwordSetup('Test1234', function (err) {
      fakeStorage = new FakeStorage() // Force server-based login
      if (err) return done(err)
      ctx.passwordLogin('js test 0', 'Test1234', done)
    })
  })

  it('check good', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)

    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) return done(err)
      assert(account.passwordOk('y768Mv4PLFupQjMu'))
      done()
    })
  })

  it('check bad', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(null, fakeStorage)

    ctx.passwordLogin('js test 0', 'y768Mv4PLFupQjMu', function (err, account) {
      if (err) return done(err)
      assert(!account.passwordOk('wrong one'))
      done()
    })
  })

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

    ctx.pinLogin('js test 0', '1234', done)
  })

  it('setup', function (done) {
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)
    var account = new Account(ctx, 'js test 0', packages.dataKey)

    account.pinSetup('1234', function (err) {
      if (err) return done(err)
      ctx.pinLogin('js test 0', '1234', done)
    })
  })

  it.skip('setup on live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()

    // If we don't remove this, `pinAuthId` will be reused,
    // breaking the package used by the "login to live server" test:
    fakeStorage.removeItem('airbitz.user.js test 0.pinAuthId')

    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    var account = new Account(ctx, 'js test 0', packages.dataKey)

    account.pinSetup('1234', function (err) {
      if (err) return done(err)
      ctx.pinLogin('js test 0', '1234', done)
    })
  })

  it.skip('login to live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(realServer.authRequest, fakeStorage)

    ctx.pinLogin('js test 0', '1234', done)
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
    var account = new Account(ctx, 'js test 0', packages.dataKey)

    account.recovery2Set(packages.recovery2Questions, packages.recovery2Answers, function (err, key) {
      if (err) return done(err)
      ctx.fetchRecovery2Questions(key, 'js test 0', function (err, questions) {
        if (err) return done(err)
        ctx.loginWithRecovery2(key, 'js test 0', packages.recovery2Answers, null, null, done)
      })
    })
  })

  it.skip('set on live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(realServer.authRequest, fakeStorage)
    var account = new Account(ctx, 'js test 0', packages.dataKey)

    account.recovery2Set(packages.recovery2Questions, packages.recovery2Answers, function (err, key) {
      if (err) return done(err)
      ctx.fetchRecovery2Questions(key, 'js test 0', function (err, questions) {
        if (err) return done(err)
        ctx.loginWithRecovery2(key, 'js test 0', packages.recovery2Answers, null, null, done)
      })
    })
  })

  it.skip('login to live server', function (done) {
    this.timeout(10000)
    var fakeStorage = new FakeStorage()
    fakeStorage.populate()
    var ctx = new abc.Context(realServer.authRequest, fakeStorage)

    ctx.loginWithRecovery2(packages.recovery2Key, 'js test 0', packages.recovery2Answers, null, null, done)
  })
})

describe('edge login', function () {
  it('request', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage)

    var opts = {
      onLogin: done,
      displayName: 'test suite'
    }

    ctx.requestEdgeLogin(opts, done)
  })
})
