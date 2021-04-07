// @flow

import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import { expectRejection } from '../../expect-rejection.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('appId', function () {
  it('can log into unknown apps', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      apiKey: '',
      appId: 'fakeApp'
    })
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })
})

describe('creation', function () {
  it('username available', async function () {
    const world = await makeFakeEdgeWorld([], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const available = await context.usernameAvailable('unknown user')
    assert(available)
  })

  it('username not available', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const available = await context.usernameAvailable(fakeUser.username)
    assert(!available)
  })

  it('password-less account', async function () {
    this.timeout(1000)
    const world = await makeFakeEdgeWorld([], quiet)
    const contextOptions = { apiKey: '', appId: 'test' }
    const context = await world.makeEdgeContext(contextOptions)
    const remote = await world.makeEdgeContext(contextOptions)
    const username = 'some fancy user'
    const questions = fakeUser.recovery2Questions
    const answers = fakeUser.recovery2Answers

    const account = await context.createAccount(
      username,
      undefined,
      fakeUser.pin
    )
    const recovery2Key = await account.changeRecovery(questions, answers)

    return Promise.all([
      context.loginWithPIN(username, fakeUser.pin),
      remote.loginWithRecovery2(recovery2Key, username, answers)
    ])
  })

  it('create account', async function () {
    this.timeout(15000)
    const now = new Date()
    const world = await makeFakeEdgeWorld([], quiet)
    const contextOptions = { apiKey: '', appId: 'test' }
    const context = await world.makeEdgeContext(contextOptions)
    const remote = await world.makeEdgeContext(contextOptions)
    const username = 'some fancy user'
    const password = 'some fancy password'
    const pin = '0218'

    const account = await context.createAccount(username, password, pin, {
      now
    })

    expect(context.localUsers).deep.equals([
      {
        keyLoginEnabled: true,
        lastLogin: now,
        pinLoginEnabled: true,
        recovery2Key: undefined,
        username: 'some fancy user',
        voucherId: undefined
      }
    ])

    return Promise.all([
      context.loginWithPIN(username, pin),
      remote.loginWithPassword(username, password),
      context.loginWithKey(username, account.loginKey)
    ])
  })
})

describe('password', function () {
  it('login offline', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    await world.goOffline()

    await context.loginWithPassword(fakeUser.username, fakeUser.password)
    await expectRejection(context.loginWithPIN(fakeUser.username, fakeUser.pin))
  })

  it('login online', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    return context.loginWithPassword(fakeUser.username, fakeUser.password)
  })

  it('change', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const longPassword = '0123456789'.repeat(10)
    await account.changePassword(longPassword)

    const remote = await world.makeEdgeContext(contextOptions)
    return remote.loginWithPassword(fakeUser.username, longPassword)
  })

  it('check good', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const ok = await account.checkPassword(fakeUser.password)
    assert(ok)
  })

  it('check bad', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const ok = await account.checkPassword('wrong one')
    assert(!ok)
  })

  it('delete', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.deletePassword()
    await expectRejection(
      context.loginWithPassword(fakeUser.username, fakeUser.password),
      'PasswordError: Invalid password'
    )
  })
})

describe('pin', function () {
  it('exists', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const exists = await context.pinLoginEnabled(fakeUser.username)
    assert(exists)
  })

  it('does not exist', async function () {
    const world = await makeFakeEdgeWorld([], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const exists = await context.pinLoginEnabled(fakeUser.username)
    assert(!exists)
  })

  it('login', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('changes', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.changePin({ pin: '4321' })
    await context.loginWithPIN(fakeUser.username, '4321')

    const remote = await world.makeEdgeContext(contextOptions)
    return remote.loginWithPIN(fakeUser.username, '4321')
  })

  it('enable / disable', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Disable PIN login:
    await account.changePin({ enableLogin: false })
    await expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: PIN login is not enabled for this account on this device'
    )

    // Since this was a legacy PIN setup, checking stops working:
    await expectRejection(
      account.checkPin(fakeUser.pin),
      'Error: No PIN set locally for this account'
    )

    // Change PIN, leaving it disabled:
    await account.changePin({ pin: '4321', enableLogin: false })
    await expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: PIN login is not enabled for this account on this device'
    )
    expect(await account.checkPin('4321')).equals(true)

    // Enable PIN login:
    await account.changePin({ enableLogin: true })
    await context.loginWithPIN(fakeUser.username, '4321')
  })

  it('check', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(await account.checkPin(fakeUser.pin)).equals(true)
    expect(await account.checkPin(fakeUser.pin + '!')).equals(false)
  })

  it('delete', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.deletePin()
    expect(await context.pinLoginEnabled(fakeUser.username)).equals(false)
  })
})

describe('recovery2', function () {
  it('get local key', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const [user] = context.localUsers
    assert.equal(user.recovery2Key, fakeUser.recovery2Key)
  })

  it('get questions', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const questions = await context.fetchRecovery2Questions(
      fakeUser.recovery2Key,
      fakeUser.username
    )

    assert.equal(questions.length, fakeUser.recovery2Questions.length)
    for (let i = 0; i < questions.length; ++i) {
      assert.equal(questions[i], fakeUser.recovery2Questions[i])
    }
  })

  it('login', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    await context.loginWithRecovery2(
      fakeUser.recovery2Key,
      fakeUser.username,
      fakeUser.recovery2Answers
    )
  })

  it('change', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const recovery2Key = await account.changeRecovery(
      fakeUser.recovery2Questions,
      fakeUser.recovery2Answers
    )
    expect(account.recoveryKey).equals(recovery2Key)

    const remote = await world.makeEdgeContext(contextOptions)
    await Promise.all([
      remote.fetchRecovery2Questions(recovery2Key, fakeUser.username),
      remote.loginWithRecovery2(
        recovery2Key,
        fakeUser.username,
        fakeUser.recovery2Answers
      )
    ])
  })

  it('delete', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const account = await context.loginWithRecovery2(
      fakeUser.recovery2Key,
      fakeUser.username,
      fakeUser.recovery2Answers
    )
    expect(account.recoveryKey).equals(fakeUser.recovery2Key)
    await account.deleteRecovery()
    expect(account.recoveryKey).equals(undefined)
  })
})
