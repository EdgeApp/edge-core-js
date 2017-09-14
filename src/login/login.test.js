// @flow
import { fakeUser, makeFakeContexts } from '../indexABC.js'
import { base58 } from '../util/encoding.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

const contextOptions = { localFakeUser: true }

describe('username', function () {
  it('normalize spaces and capitalization', function () {
    const [context] = makeFakeContexts(contextOptions)

    assert.equal('test test', context.fixUsername('  TEST TEST  '))
  })

  it('reject invalid characters', function () {
    const [context] = makeFakeContexts(contextOptions)

    assert.throws(() => context.fixUsername('テスト'))
  })

  it('list usernames in local storage', async function () {
    const [context] = makeFakeContexts(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const list = await context.listUsernames()
    assert.deepEqual(list, ['js test 0'])
  })

  it('remove username from local storage', async function () {
    const [context] = makeFakeContexts(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await context.deleteLocalAccount(fakeUser.username)
    const list = await context.listUsernames()
    assert.equal(list.length, 0)
  })
})

describe('appId', function () {
  it('can log into unknown apps', async function () {
    const [context] = makeFakeContexts({
      appId: 'fakeApp',
      localFakeUser: true
    })
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })
})

describe('creation', function () {
  it('username available', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const available = await context.usernameAvailable('js test 1')
    assert(available)
  })

  it('username not available', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const available = await context.usernameAvailable(fakeUser.username)
    assert(!available)
  })

  it('passwordless account', async function () {
    this.timeout(1000)
    const [context, remote] = makeFakeContexts(
      { appId: 'test' },
      { appId: 'test' }
    )
    const username = 'some fancy user'
    const questions = fakeUser.recovery2Questions
    const answers = fakeUser.recovery2Answers

    const account = await context.createAccount(username, void 0, fakeUser.pin)
    const recovery2Key = await account.recovery2Set(questions, answers)

    return Promise.all([
      context.loginWithPIN(username, fakeUser.pin),
      remote.loginWithRecovery2(recovery2Key, username, answers)
    ])
  })

  it('create account', async function () {
    this.timeout(15000)
    const [context, remote] = makeFakeContexts(
      { appId: 'test' },
      { appId: 'test' }
    )
    const username = 'some fancy user'
    const password = 'some fancy password'
    const pin = '0218'

    const account = await context.createAccount(username, password, pin)

    return Promise.all([
      context.loginWithPIN(username, pin),
      remote.loginWithPassword(username, password),
      context.loginWithKey(username, account.loginKey)
    ])
  })
})

describe('password', function () {
  it('setup', async function () {
    this.timeout(15000)
    const [context, remote] = makeFakeContexts(contextOptions, contextOptions)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.passwordSetup('Test1234')

    return remote.loginWithPassword(fakeUser.username, 'Test1234')
  })

  it('check good', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const ok = await account.passwordOk(fakeUser.password)
    assert(ok)
  })

  it('check bad', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const ok = await account.passwordOk('wrong one')
    assert(!ok)
  })

  it('login offline', async function () {
    const [context] = makeFakeContexts(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Disable network access (but leave the sync server up):
    const oldFetch = context.io.fetch
    context.io.fetch = (url, opts) =>
      /store/.test(url.toString())
        ? oldFetch(url, opts)
        : Promise.reject(new Error('Network error'))

    return context.loginWithPassword(fakeUser.username, fakeUser.password)
  })

  it('login online', function () {
    const [context] = makeFakeContexts(contextOptions, contextOptions)
    return context.loginWithPassword(fakeUser.username, fakeUser.password)
  })
})

describe('pin', function () {
  it('exists', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const exists = await context.pinLoginEnabled(fakeUser.username)
    assert(exists)
  })

  it('does not exist', async function () {
    const [context] = makeFakeContexts({})

    const exists = await context.pinLoginEnabled(fakeUser.username)
    assert(!exists)
  })

  it('login', async function () {
    const [context] = makeFakeContexts(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('setup', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.pinSetup('4321')
    await context.loginWithPIN(fakeUser.username, '4321')
  })
})

describe('recovery2', function () {
  it('get local key', async function () {
    const [context] = makeFakeContexts(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const recovery2Key = await context.getRecovery2Key(fakeUser.username)
    assert.equal(recovery2Key, base58.stringify(fakeUser.recovery2Key))
  })

  it('get questions', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const questions = await context.fetchRecovery2Questions(
      base58.stringify(fakeUser.recovery2Key),
      fakeUser.username
    )

    assert.equal(questions.length, fakeUser.recovery2Questions.length)
    for (let i = 0; i < questions.length; ++i) {
      assert.equal(questions[i], fakeUser.recovery2Questions[i])
    }
  })

  it('login', async function () {
    const [context] = makeFakeContexts(contextOptions)

    await context.loginWithRecovery2(
      base58.stringify(fakeUser.recovery2Key),
      fakeUser.username,
      fakeUser.recovery2Answers
    )
  })

  it('set', async function () {
    const [context, remote] = makeFakeContexts(contextOptions, contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const recovery2Key = await account.recovery2Set(
      fakeUser.recovery2Questions,
      fakeUser.recovery2Answers
    )

    await Promise.all([
      remote.fetchRecovery2Questions(recovery2Key, fakeUser.username),
      remote.loginWithRecovery2(
        recovery2Key,
        fakeUser.username,
        fakeUser.recovery2Answers
      )
    ])
  })
})
