import { makeContext, makeFakeIos } from '../indexABC.js'
import { fakeUser, makeFakeAccount } from '../test/fakeUser.js'
import { base58 } from '../util/encoding.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

function makeFakeContexts (count, opts) {
  return makeFakeIos(count).map(io => makeContext({ ...opts, io }))
}

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

    return makeFakeAccount(context, fakeUser).then(() =>
      context.usernameList().then(list => assert.deepEqual(list, ['js test 0']))
    )
  })

  it('remove username from local storage', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(() =>
      context
        .removeUsername(fakeUser.username)
        .then(() => context.usernameList())
        .then(list => assert.equal(list.length, 0))
    )
  })
})

describe('appId', function () {
  it('can log into unknown apps', function () {
    const [io] = makeFakeIos(1)
    const context = makeContext({ io, appId: 'fakeApp' })

    return makeFakeAccount(context, fakeUser)
  })
})

describe('creation', function () {
  it('username available', function () {
    const [context, remote] = makeFakeContexts(2)

    return makeFakeAccount(remote, fakeUser).then(() =>
      context.usernameAvailable('js test 1').then(result => assert(result))
    )
  })

  it('username not available', function () {
    const [context, remote] = makeFakeContexts(2)

    return makeFakeAccount(remote, fakeUser).then(() =>
      context
        .usernameAvailable(fakeUser.username)
        .then(result => assert(!result))
    )
  })

  it('passwordless account', function () {
    this.timeout(1000)
    const [context, remote] = makeFakeContexts(2, { appId: 'test' })

    const username = 'some fancy user'
    const questions = fakeUser.recovery2Questions
    const answers = fakeUser.recovery2Answers
    const recovery2Key = context
      .createAccount(username, null, fakeUser.pin)
      .then(account => account.recovery2Set(questions, answers))

    return recovery2Key.then(recovery2Key =>
      Promise.all([
        context.loginWithPIN(username, fakeUser.pin, null, null),
        remote.loginWithRecovery2(recovery2Key, username, answers, null, null)
      ])
    )
  })

  it('create account', function () {
    this.timeout(15000)
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
          ),
          context.loginWithKey(fakeUser.username, account.loginKey)
        ])
      })
  })
})

describe('password', function () {
  it('setup', function () {
    this.timeout(15000)
    const [context, remote] = makeFakeContexts(2)

    return makeFakeAccount(context, fakeUser).then(account =>
      account
        .passwordSetup('Test1234')
        .then(() =>
          remote.loginWithPassword(fakeUser.username, 'Test1234', null, null)
        )
    )
  })

  it('check good', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account =>
      account.passwordOk(fakeUser.password).then(result => assert(result))
    )
  })

  it('check bad', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account =>
      account.passwordOk('wrong one').then(result => assert(!result))
    )
  })

  it('login offline', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(() => {
      // Disable network access (but leave the sync server up):
      const oldFetch = context.io.fetch
      context.io.fetch = (url, opts) =>
        /store/.test(url)
          ? oldFetch(url, opts)
          : Promise.reject(new Error('Network error'))

      return context.loginWithPassword(
        fakeUser.username,
        fakeUser.password,
        null,
        null
      )
    })
  })

  it('login online', function () {
    const [context, remote] = makeFakeContexts(2)

    return makeFakeAccount(remote, fakeUser).then(() =>
      context.loginWithPassword(
        fakeUser.username,
        fakeUser.password,
        null,
        null
      )
    )
  })
})

describe('pin', function () {
  it('exists', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(() =>
      context.pinExists(fakeUser.username).then(result => assert(result))
    )
  })

  it('does not exist', function () {
    const [context] = makeFakeContexts(1)

    return context.pinExists(fakeUser.username).then(result => assert(!result))
  })

  it('login', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(() =>
      context.loginWithPIN(fakeUser.username, fakeUser.pin)
    )
  })

  it('child login', function () {
    const trimmedUser = { ...fakeUser, pin2Key: null }

    const [io] = makeFakeIos(1)
    const context = makeContext({ io, appId: 'test-child' })
    const fakeContext = { io: context.io, appId: '' }

    return makeFakeAccount(fakeContext, trimmedUser).then(() =>
      context
        .loginWithPIN(fakeUser.username, fakeUser.pin)
        .then(account => assert.equal(account.appId, 'test-child'))
    )
  })

  it('setup', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account =>
      account
        .pinSetup('4321')
        .then(() => context.loginWithPIN(fakeUser.username, '4321'))
    )
  })
})

describe('recovery2', function () {
  it('get local key', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(() =>
      context
        .getRecovery2Key(fakeUser.username)
        .then(key => assert.equal(key, base58.stringify(fakeUser.recovery2Key)))
    )
  })

  it('get questions', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(() =>
      context
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
    )
  })

  it('login', function () {
    const [context, remote] = makeFakeContexts(2)

    return makeFakeAccount(remote, fakeUser).then(() =>
      context.loginWithRecovery2(
        base58.stringify(fakeUser.recovery2Key),
        fakeUser.username,
        fakeUser.recovery2Answers,
        null,
        null
      )
    )
  })

  it('set', function () {
    const [context, remote] = makeFakeContexts(2)

    return makeFakeAccount(context, fakeUser).then(account =>
      account
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
    )
  })
})
