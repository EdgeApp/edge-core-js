/* global describe, it */
import * as abc from '../src/abc.js'
import * as packages from './fake/packages.js'
import {makeFakeContexts} from './fake/session.js'
import assert from 'assert'

describe('login', function () {
  it('find repo', function () {
    const [context] = makeFakeContexts(1)
    const login = packages.makeAccount(context).login

    assert.ok(login.accountFind('account:repo:co.airbitz.wallet'))
    assert.throws(function () {
      login.accountFind('account:repo:blah')
    })
  })

  it('attach repo', function () {
    const [context] = makeFakeContexts(1)
    const login = packages.makeAccount(context).login

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
    packages.makeAccount(context)

    assert.deepEqual(context.usernameList(), ['js test 0'])
  })

  it('remove username from local storage', function () {
    const [context] = makeFakeContexts(1)
    packages.makeAccount(context)

    context.removeUsername('js Test 0')
    assert.equal(context.usernameList().length, 0)
  })
})

describe('creation', function () {
  it('username available', function (done) {
    const [context, remote] = makeFakeContexts(2)
    packages.makeAccount(remote)

    context.usernameAvailable('js test 1', done)
  })

  it('username not available', function (done) {
    const [context, remote] = makeFakeContexts(2)
    packages.makeAccount(remote)

    context.usernameAvailable('js Test 0', function (err) { done(!err) })
  })

  it('create account', function (done) {
    this.timeout(9000)
    const [context, remote] = makeFakeContexts(2, {accountType: 'account:repo:test'})

    context.createAccount('js Test 0', 'y768Mv4PLFupQjMu', '1234', function (err, account) {
      if (err) return done(err)
      // Try logging in:
      remote.loginWithPassword('js Test 0', 'y768Mv4PLFupQjMu', null, null, done)
    })
  })
})

describe('password', function () {
  it('setup', function (done) {
    this.timeout(9000)
    const [context, remote] = makeFakeContexts(2)
    const account = packages.makeAccount(context)

    account.passwordSetup('Test1234', function (err) {
      if (err) return done(err)
      remote.loginWithPassword('js Test 0', 'Test1234', null, null, done)
    })
  })

  it('check good', function () {
    const [context] = makeFakeContexts(1)
    const account = packages.makeAccount(context)

    return account.passwordOk('y768Mv4PLFupQjMu').then(result => assert(result))
  })

  it('check bad', function () {
    const [context] = makeFakeContexts(1)
    const account = packages.makeAccount(context)

    return account.passwordOk('wrong one').then(result => assert(!result))
  })

  it('login offline', function (done) {
    const [context] = makeFakeContexts(1)
    packages.makeAccount(context)

    // Disable network access (but leave the sync server up):
    const oldFetch = context.io.fetch
    context.io.fetch = (url, opts) =>
      /store/.test(url)
        ? oldFetch(url, opts)
        : Promise.reject(new Error('Network error'))

    context.loginWithPassword('js Test 0', 'y768Mv4PLFupQjMu', null, null, done)
  })

  it('login online', function (done) {
    const [context, remote] = makeFakeContexts(2)
    packages.makeAccount(remote)

    context.loginWithPassword('js Test 0', 'y768Mv4PLFupQjMu', null, null, done)
  })
})

describe('pin', function () {
  it('exists', function () {
    const [context] = makeFakeContexts(1)
    packages.makeAccount(context)

    assert.equal(context.pinExists('js Test 0'), true)
  })

  it('does not exist', function () {
    const [context] = makeFakeContexts(1)

    assert.equal(context.pinExists('js Test 0'), false)
  })

  it('login', function (done) {
    const [context] = makeFakeContexts(1)
    packages.makeAccount(context)

    context.loginWithPIN('js Test 0', '1234', done)
  })

  it('setup', function (done) {
    const [context] = makeFakeContexts(1)
    const account = packages.makeAccount(context)

    account.pinSetup('4321', function (err) {
      if (err) return done(err)
      context.loginWithPIN('js Test 0', '4321', done)
    })
  })
})

describe('recovery2', function () {
  it('get local key', function (done) {
    const [context] = makeFakeContexts(1)
    packages.makeAccount(context)

    context.getRecovery2Key('js Test 0', function (err, key) {
      if (err) return done(err)
      assert.equal(key, packages.recovery2Key)
      done()
    })
  })

  it('get questions', function (done) {
    const [context] = makeFakeContexts(1)
    packages.makeAccount(context)

    context.fetchRecovery2Questions(packages.recovery2Key, 'js Test 0', function (err, questions) {
      if (err) return done(err)
      assert.equal(questions.length, packages.recovery2Questions.length)
      for (let i = 0; i < questions.length; ++i) {
        assert.equal(questions[i], packages.recovery2Questions[i])
      }
      done()
    })
  })

  it('login', function (done) {
    const [context, remote] = makeFakeContexts(2)
    packages.makeAccount(remote)

    context.loginWithRecovery2(packages.recovery2Key, 'js Test 0', packages.recovery2Answers, null, null, done)
  })

  it('set', function (done) {
    const [context, remote] = makeFakeContexts(2)
    const account = packages.makeAccount(context)

    account.recovery2Set(packages.recovery2Questions, packages.recovery2Answers, function (err, key) {
      if (err) return done(err)
      remote.fetchRecovery2Questions(key, 'js Test 0', function (err, questions) {
        if (err) return done(err)
        remote.loginWithRecovery2(key, 'js Test 0', packages.recovery2Answers, null, null, done)
      })
    })
  })
})
