/* global describe, it */
import { makeContext, makeFakeIos } from '../src'
import { attachKeys, makeKeyInfo } from '../src/login/login.js'
import { base58, base64 } from '../src/util/encoding.js'
import { objectAssign } from '../src/util/util.js'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

function makeFakeContexts (count) {
  return makeFakeIos(count).map(io => makeContext({ io }))
}

function findKeys (login, type) {
  return login.keyInfos.find(info => info.type === type)
}

describe('login', function () {
  it('find repo', function () {
    const [context] = makeFakeContexts(1)
    const login = makeFakeAccount(context, fakeUser).login

    const accountRepo = findKeys(login, 'account-repo:co.airbitz.wallet')
    assert(accountRepo)
    assert.equal(accountRepo.keys.syncKey, base64.stringify(fakeUser.syncKey))
    assert(findKeys(login, 'account-repo:blah') == null)
  })

  it('attach repo', function () {
    const [context] = makeFakeContexts(1)
    const login = makeFakeAccount(context, fakeUser).login

    const keysJson = {
      dataKey: 'fa57',
      syncKey: 'f00d'
    }
    const keyInfo = makeKeyInfo(keysJson, 'account-repo:blah', [])
    return attachKeys(context.io, login, login, [keyInfo]).then(() => {
      assert.deepEqual(findKeys(login, 'account-repo:blah'), keyInfo)
      return null
    })
  })
})

describe('username', function () {
  it('normalize spaces and capitalization', function () {
    const [context] = makeFakeContexts(1)

    assert.equal('test test', context.fixUsername('  TEST TEST  '))
  })

  it('reject invalid characters', function () {
    const [context] = makeFakeContexts(1)

    assert.throws(() => context.fixUsername('テスト'))
  })

  it('list usernames in local storage', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    return context
      .usernameList()
      .then(list => assert.deepEqual(list, ['js test 0']))
  })

  it('remove username from local storage', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    context.removeUsername(fakeUser.username)
    return context.usernameList().then(list => assert.equal(list.length, 0))
  })
})

describe('creation', function () {
  it('username available', function () {
    const [context, remote] = makeFakeContexts(2)
    makeFakeAccount(remote, fakeUser)

    context.usernameAvailable('js test 1').then(result => assert(result))
  })

  it('username not available', function () {
    const [context, remote] = makeFakeContexts(2)
    makeFakeAccount(remote, fakeUser)

    context.usernameAvailable(fakeUser.username).then(result => assert(!result))
  })

  it('create account', function () {
    this.timeout(9000)
    const [context, remote] = makeFakeContexts(2, { appId: 'test' })

    return context
      .createAccount(fakeUser.username, fakeUser.password, fakeUser.pin)
      .then(account => {
        return Promise.all([
          context.loginWithPIN(fakeUser.username, fakeUser.pin, null, null),
          remote.loginWithPassword(
            fakeUser.username,
            fakeUser.password,
            null,
            null
          )
        ])
      })
  })
})

describe('password', function () {
  it('setup', function () {
    this.timeout(9000)
    const [context, remote] = makeFakeContexts(2)
    const account = makeFakeAccount(context, fakeUser)

    return account.passwordSetup('Test1234').then(() => {
      return remote.loginWithPassword(fakeUser.username, 'Test1234', null, null)
    })
  })

  it('check good', function () {
    const [context] = makeFakeContexts(1)
    const account = makeFakeAccount(context, fakeUser)

    return account.passwordOk(fakeUser.password).then(result => {
      return assert(result)
    })
  })

  it('check bad', function () {
    const [context] = makeFakeContexts(1)
    const account = makeFakeAccount(context, fakeUser)

    return account.passwordOk('wrong one').then(result => {
      return assert(!result)
    })
  })

  it('login offline', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    // Disable network access (but leave the sync server up):
    const oldFetch = context.io.fetch
    context.io.fetch = (url, opts) =>
      (/store/.test(url)
        ? oldFetch(url, opts)
        : Promise.reject(new Error('Network error')))

    return context.loginWithPassword(
      fakeUser.username,
      fakeUser.password,
      null,
      null
    )
  })

  it('login online', function () {
    const [context, remote] = makeFakeContexts(2)
    makeFakeAccount(remote, fakeUser)

    return context.loginWithPassword(
      fakeUser.username,
      fakeUser.password,
      null,
      null
    )
  })
})

describe('pin', function () {
  it('exists', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    return context.pinExists(fakeUser.username).then(result => assert(result))
  })

  it('does not exist', function () {
    const [context] = makeFakeContexts(1)

    return context.pinExists(fakeUser.username).then(result => assert(!result))
  })

  it('login', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    return context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('child login', function () {
    const trimmedUser = objectAssign({}, fakeUser)
    trimmedUser.pin2Key = null

    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, trimmedUser)
    context.appId = 'test-child'

    return context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(account => assert.equal(account.login.appId, 'test-child'))
  })

  it('setup', function () {
    const [context] = makeFakeContexts(1)
    const account = makeFakeAccount(context, fakeUser)

    return account.pinSetup('4321').then(() => {
      return context.loginWithPIN(fakeUser.username, '4321')
    })
  })
})

describe('recovery2', function () {
  it('get local key', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    return context.getRecovery2Key(fakeUser.username).then(key => {
      return assert.equal(key, base58.stringify(fakeUser.recovery2Key))
    })
  })

  it('get questions', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)

    return context
      .fetchRecovery2Questions(
        base58.stringify(fakeUser.recovery2Key),
        fakeUser.username
      )
      .then(questions => {
        assert.equal(questions.length, fakeUser.recovery2Questions.length)
        for (let i = 0; i < questions.length; ++i) {
          assert.equal(questions[i], fakeUser.recovery2Questions[i])
        }
        return true
      })
  })

  it('login', function () {
    const [context, remote] = makeFakeContexts(2)
    makeFakeAccount(remote, fakeUser)

    return context.loginWithRecovery2(
      base58.stringify(fakeUser.recovery2Key),
      fakeUser.username,
      fakeUser.recovery2Answers,
      null,
      null
    )
  })

  it('set', function () {
    const [context, remote] = makeFakeContexts(2)
    const account = makeFakeAccount(context, fakeUser)

    return account
      .recovery2Set(fakeUser.recovery2Questions, fakeUser.recovery2Answers)
      .then(key =>
        Promise.all([
          remote.fetchRecovery2Questions(key, fakeUser.username),
          remote.loginWithRecovery2(
            key,
            fakeUser.username,
            fakeUser.recovery2Answers,
            null,
            null
          )
        ])
      )
  })
})
