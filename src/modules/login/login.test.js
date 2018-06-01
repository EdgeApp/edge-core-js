// @flow

import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import { error, fakeUser, makeFakeContexts } from '../../edge-core-index.js'
import { base58 } from '../../util/encoding.js'

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

  it('password-less account', async function () {
    this.timeout(1000)
    const [context, remote] = makeFakeContexts(
      { appId: 'test' },
      { appId: 'test' }
    )
    const username = 'some fancy user'
    const questions = fakeUser.recovery2Questions
    const answers = fakeUser.recovery2Answers

    const account = await context.createAccount(username, void 0, fakeUser.pin)
    const recovery2Key = await account.changeRecovery(questions, answers)

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

describe('otp', function () {
  it('local login works', async function () {
    const [context] = makeFakeContexts(contextOptions, contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account.otpKey != null).to.equal(true)
    await account.disableOtp()
    expect(account.otpKey == null).to.equal(true)
    await account.enableOtp()
    expect(account.otpKey != null).to.equal(true)

    // Can still log in locally:
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('remote login fails', async function () {
    const [context, remote] = makeFakeContexts(contextOptions, contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.disableOtp()
    await account.enableOtp()

    // Cannot log in remotely:
    await remote.loginWithPIN(fakeUser.username, fakeUser.pin).catch(e => {
      expect(e.name).to.equal(error.OtpError.name)
      return context.requestOtpReset(fakeUser.username, e.resetToken)
    })

    // Can log in remotely with the token:
    await remote.loginWithPIN(fakeUser.username, fakeUser.pin, {
      otp: account.otpKey
    })

    // Verify that a reset has been requested:
    const messages1 = await context.fetchLoginMessages()
    expect(messages1['js test 0'].otpResetPending).to.equal(true)

    // Cancel the reset:
    await account.cancelOtpReset()
    const messages2 = await context.fetchLoginMessages()
    expect(messages2['js test 0'].otpResetPending).to.equal(false)
  })
})

describe('password', function () {
  it('login offline', async function () {
    const [context] = makeFakeContexts(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Disable network access (but leave the sync server up):
    const oldFetch = context.io.fetch
    const ioHack: any = context.io
    ioHack.fetch = (url, opts) =>
      /store/.test(url.toString())
        ? oldFetch(url, opts)
        : Promise.reject(new Error('Network error'))

    return context.loginWithPassword(fakeUser.username, fakeUser.password)
  })

  it('login online', function () {
    const [context] = makeFakeContexts(contextOptions, contextOptions)
    return context.loginWithPassword(fakeUser.username, fakeUser.password)
  })

  it('change', async function () {
    this.timeout(15000)
    const [context, remote] = makeFakeContexts(contextOptions, contextOptions)
    const longPassword = '0123456789'.repeat(10)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePassword(longPassword)

    return remote.loginWithPassword(fakeUser.username, longPassword)
  })

  it('check good', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const ok = await account.checkPassword(fakeUser.password)
    assert(ok)
  })

  it('check bad', async function () {
    const [context] = makeFakeContexts(contextOptions)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const ok = await account.checkPassword('wrong one')
    assert(!ok)
  })

  it('delete', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.deletePassword()
    return context
      .loginWithPassword(fakeUser.username, fakeUser.password)
      .then(x => Promise.reject(x), x => x)
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

  it('changes', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.changePin({ pin: '4321' })
    await context.loginWithPIN(fakeUser.username, '4321')
  })

  it('enable / disable', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Disable PIN login:
    await account.changePin({ enableLogin: false })
    await context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(ok => Promise.reject(new Error('Should fail')), e => true)

    // Change PIN, leaving it disabled:
    expect(await account.checkPin(fakeUser.pin)).to.equal(true)
    await account.changePin({ pin: '4321' })
    await context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(ok => Promise.reject(new Error('Should fail')), e => true)
    expect(await account.checkPin('4321')).to.equal(true)

    // Enable PIN login:
    await account.changePin({ enableLogin: true })
    await context.loginWithPIN(fakeUser.username, '4321')
  })

  it('check', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(await account.checkPin(fakeUser.pin)).to.equal(true)
    expect(await account.checkPin(fakeUser.pin + '!')).to.equal(false)
  })

  it('delete', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.deletePin()
    expect(await context.pinLoginEnabled(fakeUser.username)).to.equal(false)
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

  it('change', async function () {
    const [context, remote] = makeFakeContexts(contextOptions, contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const recovery2Key = await account.changeRecovery(
      fakeUser.recovery2Questions,
      fakeUser.recovery2Answers
    )
    expect(account.recoveryKey).to.equal(recovery2Key)

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
    const [context] = makeFakeContexts(contextOptions)

    const account = await context.loginWithRecovery2(
      base58.stringify(fakeUser.recovery2Key),
      fakeUser.username,
      fakeUser.recovery2Answers
    )
    expect(account.recoveryKey).to.equal(
      base58.stringify(fakeUser.recovery2Key)
    )
    await account.deleteRecovery()
    expect(account.recoveryKey).to.equal(void 0)
  })
})
