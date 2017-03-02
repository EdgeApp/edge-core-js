/* global describe, it */
import * as abc from '../src/abc.js'
import * as fakeUser from './fake/fakeUser.js'
import {makeFakeContexts} from './fake/session.js'
import assert from 'assert'

describe('login', function () {
  it('find repo', function () {
    const [context] = makeFakeContexts(1)
    const login = fakeUser.makeAccount(context).login

    assert.ok(login.accountFind('account:repo:co.airbitz.wallet'))
    assert.throws(function () {
      login.accountFind('account:repo:blah')
    })
  })

  it('attach repo', function () {
    const [context] = makeFakeContexts(1)
    const login = fakeUser.makeAccount(context).login

    const info = {
      dataKey: 'fa57',
      syncKey: 'f00d'
    }
    return login.accountAttach(context.io, 'account:repo:test', info).then(() => {
      assert.deepEqual(login.accountFind('account:repo:test'), info)
      return null
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
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    assert.deepEqual(context.usernameList(), ['js test 0'])
  })

  it('remove username from local storage', function () {
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    context.removeUsername(fakeUser.username)
    assert.equal(context.usernameList().length, 0)
  })
})

describe('creation', function () {
  it('username available', function (done) {
    const [context, remote] = makeFakeContexts(2)
    fakeUser.makeAccount(remote)

    context.usernameAvailable('js test 1', done)
  })

  it('username not available', function (done) {
    const [context, remote] = makeFakeContexts(2)
    fakeUser.makeAccount(remote)

    context.usernameAvailable(fakeUser.username, function (err) { done(!err) })
  })

  it('create account', function (done) {
    this.timeout(9000)
    const [context, remote] = makeFakeContexts(2, {accountType: 'account:repo:test'})

    context.createAccount(fakeUser.username, fakeUser.password, fakeUser.pin, function (err, account) {
      if (err) return done(err)
      // Try logging in:
      remote.loginWithPassword(fakeUser.username, fakeUser.password, null, null, done)
    })
  })
})

describe('password', function () {
  it('setup', function (done) {
    this.timeout(9000)
    const [context, remote] = makeFakeContexts(2)
    const account = fakeUser.makeAccount(context)

    account.passwordSetup('Test1234', function (err) {
      if (err) return done(err)
      remote.loginWithPassword(fakeUser.username, 'Test1234', null, null, done)
    })
  })

  it('check good', function () {
    const [context] = makeFakeContexts(1)
    const account = fakeUser.makeAccount(context)

    return account.passwordOk(fakeUser.password).then(result => assert(result))
  })

  it('check bad', function () {
    const [context] = makeFakeContexts(1)
    const account = fakeUser.makeAccount(context)

    return account.passwordOk('wrong one').then(result => assert(!result))
  })

  it('login offline', function (done) {
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    // Disable network access (but leave the sync server up):
    const oldFetch = context.io.fetch
    context.io.fetch = (url, opts) =>
      /store/.test(url)
        ? oldFetch(url, opts)
        : Promise.reject(new Error('Network error'))

    context.loginWithPassword(fakeUser.username, fakeUser.password, null, null, done)
  })

  it('login online', function (done) {
    const [context, remote] = makeFakeContexts(2)
    fakeUser.makeAccount(remote)

    context.loginWithPassword(fakeUser.username, fakeUser.password, null, null, done)
  })
})

describe('pin', function () {
  it('exists', function () {
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    assert.equal(context.pinExists(fakeUser.username), true)
  })

  it('does not exist', function () {
    const [context] = makeFakeContexts(1)

    assert.equal(context.pinExists(fakeUser.username), false)
  })

  it('login', function (done) {
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    context.loginWithPIN(fakeUser.username, fakeUser.pin, done)
  })

  it('setup', function (done) {
    const [context] = makeFakeContexts(1)
    const account = fakeUser.makeAccount(context)

    account.pinSetup('4321', function (err) {
      if (err) return done(err)
      context.loginWithPIN(fakeUser.username, '4321', done)
    })
  })
})

describe('recovery2', function () {
  it('get local key', function (done) {
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    context.getRecovery2Key(fakeUser.username, function (err, key) {
      if (err) return done(err)
      assert.equal(key, fakeUser.recovery2Key)
      done()
    })
  })

  it('get questions', function (done) {
    const [context] = makeFakeContexts(1)
    fakeUser.makeAccount(context)

    context.fetchRecovery2Questions(fakeUser.recovery2Key, fakeUser.username, function (err, questions) {
      if (err) return done(err)
      assert.equal(questions.length, fakeUser.recovery2Questions.length)
      for (let i = 0; i < questions.length; ++i) {
        assert.equal(questions[i], fakeUser.recovery2Questions[i])
      }
      done()
    })
  })

  it('login', function (done) {
    const [context, remote] = makeFakeContexts(2)
    fakeUser.makeAccount(remote)

    context.loginWithRecovery2(fakeUser.recovery2Key, fakeUser.username, fakeUser.recovery2Answers, null, null, done)
  })

  it('set', function (done) {
    const [context, remote] = makeFakeContexts(2)
    const account = fakeUser.makeAccount(context)

    account.recovery2Set(fakeUser.recovery2Questions, fakeUser.recovery2Answers, function (err, key) {
      if (err) return done(err)
      remote.fetchRecovery2Questions(key, fakeUser.username, function (err, questions) {
        if (err) return done(err)
        remote.loginWithRecovery2(key, fakeUser.username, fakeUser.recovery2Answers, null, null, done)
      })
    })
  })
})
