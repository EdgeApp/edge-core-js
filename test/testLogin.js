/* global describe, it */
import * as abc from '../src/abc.js'
import * as packages from './fake/packages.js'
import {makeSession} from './fake/session.js'
import assert from 'assert'

describe('login', function () {
  it('find repo', function () {
    const session = makeSession({needsLogin: true})

    assert.ok(session.login.accountFind('account:repo:co.airbitz.wallet'))
    assert.throws(function () {
      session.login.accountFind('account:repo:blah')
    })
  })

  it('attach repo', function () {
    const session = makeSession({needsLogin: true})
    session.server.populate()

    const info = {
      dataKey: 'fa57',
      syncKey: 'f00d'
    }
    return session.login.accountAttach(session.context.io, 'account:repo:test', info).then(() => {
      assert.deepEqual(session.login.accountFind('account:repo:test'), info)
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
    const session = makeSession({needsContext: true})
    session.storage.populateUsers()

    assert.deepEqual(session.context.usernameList(), ['js test 0'])
  })

  it('remove username from local storage', function () {
    const session = makeSession({needsContext: true})
    session.storage.populate()

    session.context.removeUsername('js test 0')
    assert.equal(session.context.usernameList().length, 0)
  })
})

describe('creation', function () {
  it('username available', function (done) {
    const session = makeSession({needsContext: true})
    session.server.populate()

    session.context.usernameAvailable('js test 1', done)
  })

  it('username not available', function (done) {
    const session = makeSession({needsContext: true})
    session.server.populate()

    session.context.usernameAvailable('js test 0', function (err) { done(!err) })
  })

  it('create account', function (done) {
    this.timeout(9000)
    const session = makeSession({needsContext: true, accountType: 'account:repo:test'})

    session.context.createAccount('js test 0', 'y768Mv4PLFupQjMu', '1234', function (err, account) {
      if (err) return done(err)
      // Try logging in:
      session.context.loginWithPassword('js test 0', 'y768Mv4PLFupQjMu', null, null, done)
    })
  })
})

describe('password', function () {
  it('setup', function (done) {
    this.timeout(9000)
    const session = makeSession({needsAccount: true})
    session.server.populate()

    session.account.passwordSetup('Test1234', function (err) {
      if (err) return done(err)
      session.storage.clear() // Force server-based login
      session.context.loginWithPassword('js test 0', 'Test1234', null, null, done)
    })
  })

  it('check good', function () {
    const session = makeSession({needsAccount: true})

    return session.account.passwordOk('y768Mv4PLFupQjMu').then(result => assert(result))
  })

  it('check bad', function () {
    const session = makeSession({needsAccount: true})

    return session.account.passwordOk('wrong one').then(result => assert(!result))
  })

  it('login offline', function (done) {
    const session = makeSession({needsContext: true})
    session.storage.populate()
    session.server.populateRepos()

    session.context.loginWithPassword('js test 0', 'y768Mv4PLFupQjMu', null, null, done)
  })

  it('login online', function (done) {
    const session = makeSession({needsContext: true})
    session.server.populate()

    session.context.loginWithPassword('js test 0', 'y768Mv4PLFupQjMu', null, null, done)
  })
})

describe('pin', function () {
  it('exists', function () {
    const session = makeSession({needsContext: true})
    session.storage.populate()

    assert.equal(session.context.pinExists('js test 0'), true)
  })

  it('does not exist', function () {
    const session = makeSession({needsContext: true})

    assert.equal(session.context.pinExists('js test 0'), false)
  })

  it('login', function (done) {
    const session = makeSession({needsContext: true})
    session.server.populate()
    session.storage.populate()

    session.context.loginWithPIN('js test 0', '1234', done)
  })

  it('setup', function (done) {
    const session = makeSession({needsAccount: true})
    session.server.populateRepos()

    session.account.pinSetup('1234', function (err) {
      if (err) return done(err)
      session.context.loginWithPIN('js test 0', '1234', done)
    })
  })
})

describe('recovery2', function () {
  it('get local key', function (done) {
    const session = makeSession({needsContext: true})
    session.storage.populate()

    session.context.getRecovery2Key('js test 0', function (err, key) {
      if (err) return done(err)
      assert.equal(key, packages.recovery2Key)
      done()
    })
  })

  it('get questions', function (done) {
    const session = makeSession({needsContext: true})
    session.server.populate()

    session.context.fetchRecovery2Questions(packages.recovery2Key, 'js test 0', function (err, questions) {
      if (err) return done(err)
      assert.equal(questions.length, packages.recovery2Questions.length)
      for (let i = 0; i < questions.length; ++i) {
        assert.equal(questions[i], packages.recovery2Questions[i])
      }
      done()
    })
  })

  it('login', function (done) {
    const session = makeSession({needsContext: true})
    session.server.populate()

    session.context.loginWithRecovery2(packages.recovery2Key, 'js test 0', packages.recovery2Answers, null, null, done)
  })

  it('set', function (done) {
    const session = makeSession({needsAccount: true})
    session.server.populate()

    session.account.recovery2Set(packages.recovery2Questions, packages.recovery2Answers, function (err, key) {
      if (err) return done(err)
      session.context.fetchRecovery2Questions(key, 'js test 0', function (err, questions) {
        if (err) return done(err)
        session.context.loginWithRecovery2(key, 'js test 0', packages.recovery2Answers, null, null, done)
      })
    })
  })
})
