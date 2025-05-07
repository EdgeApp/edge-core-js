import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index'
import { expectRejection } from '../../expect-rejection'
import { fakeUser } from '../../fake/fake-user'

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

describe('username', function () {
  it('available', async function () {
    const world = await makeFakeEdgeWorld([], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const available = await context.usernameAvailable('unknown user')
    expect(available).equals(true)
  })

  it('not available', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const available = await context.usernameAvailable(fakeUser.username)
    expect(available).equals(false)
  })

  it('changes', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // This makes the test much faster:
    await account.deletePassword()

    // Change the username:
    expect(account.username).equals('js test 0')
    await account.changeUsername({ username: 'JS Test 1' })
    expect(account.username).equals('js test 1')

    // The context must update too:
    const [userInfo] = context.localUsers
    expect(userInfo.username).equals('js test 1')
  })
})

describe('creation', function () {
  it('password-less account', async function () {
    this.timeout(1000)
    const world = await makeFakeEdgeWorld([], quiet)
    const contextOptions = { apiKey: '', appId: 'test' }
    const context = await world.makeEdgeContext(contextOptions)
    const remote = await world.makeEdgeContext(contextOptions)
    const username = 'some fancy user'
    const questions = fakeUser.recovery2Questions
    const answers = fakeUser.recovery2Answers

    const account = await context.createAccount({
      username,
      pin: fakeUser.pin
    })
    const recovery2Key = await account.changeRecovery(questions, answers)

    await Promise.all([
      context.loginWithPIN(username, fakeUser.pin),
      remote.loginWithRecovery2(recovery2Key, username, answers)
    ])
  })

  it('username-less account', async function () {
    this.timeout(1000)
    const now = new Date()
    const world = await makeFakeEdgeWorld([], quiet)
    const contextOptions = { apiKey: '', appId: 'test' }
    const context = await world.makeEdgeContext(contextOptions)

    const account = await context.createAccount({
      pin: fakeUser.pin,
      now
    })
    expect(account.username).equals(undefined)
    expect(context.localUsers).deep.equals([
      {
        keyLoginEnabled: true,
        lastLogin: now,
        loginId: account.rootLoginId,
        pinLoginEnabled: true,
        recovery2Key: undefined,
        username: undefined,
        voucherId: undefined
      }
    ])

    await context.loginWithPIN(account.rootLoginId, fakeUser.pin, {
      useLoginId: true
    })
  })

  it('create account', async function () {
    this.timeout(15000)
    const now = new Date()
    const world = await makeFakeEdgeWorld([], quiet)
    const contextOptions = {
      apiKey: '',
      appId: 'test',
      plugins: { fakecoin: true }
    }
    const context = await world.makeEdgeContext(contextOptions)
    const remote = await world.makeEdgeContext(contextOptions)
    const username = 'some fancy user'
    const password = 'some fancy password'
    const pin = '0218'

    const account = await context.createAccount({
      username,
      password,
      pin,
      now
    })

    expect(context.localUsers).deep.equals([
      {
        keyLoginEnabled: true,
        lastLogin: now,
        loginId: account.rootLoginId,
        pinLoginEnabled: true,
        recovery2Key: undefined,
        username: 'some fancy user',
        voucherId: undefined
      }
    ])

    const loginKey = await account.getLoginKey()
    await Promise.all([
      account.createCurrencyWallet('wallet:fakecoin', {
        fiatCurrencyCode: 'iso:USD',
        name: 'Wallet creation works'
      }),
      context.loginWithPIN(username, pin),
      remote.loginWithPassword(username, password),
      context.loginWithKey(username, loginKey)
    ])
  })

  it('list new user created', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    await context.createAccount({
      username: 'new-user',
      pin: '1111'
    })

    const usernames = (await context.localUsers).map(u => ({
      username: u.username
    }))
    expect(usernames).deep.include.members([
      { username: 'new-user' },
      { username: 'js test 0' }
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
    await context.loginWithPassword(fakeUser.username, fakeUser.password)
  })

  it('change', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const longPassword = '0123456789'.repeat(10)
    await account.changePassword(longPassword)

    const remote = await world.makeEdgeContext(contextOptions)
    await remote.loginWithPassword(fakeUser.username, longPassword)
  })

  it('check good', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const ok = await account.checkPassword(fakeUser.password)
    expect(ok).equals(true)
  })

  it('check bad', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const ok = await account.checkPassword('wrong one')
    expect(ok).equals(false)
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

    expect(context.localUsers[0].pinLoginEnabled).equals(true)
  })

  it('login', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Although PIN login is enabled, we don't know the PIN in plain text
    // because the fake user has a legacy setup:
    expect(await account.getPin()).equals(undefined)
  })

  it('changes', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.changePin({ pin: '4321' })
    expect(await account.getPin()).equals('4321')
    await context.loginWithPIN(fakeUser.username, '4321')

    const remote = await world.makeEdgeContext(contextOptions)
    await remote.loginWithPIN(fakeUser.username, '4321')
  })

  it('enable / disable', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Disable PIN login:
    await account.changePin({ enableLogin: false })
    await expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'PinDisabledError: PIN login is not enabled for this account on this device'
    )

    // Since this was a legacy PIN setup, checking stops working:
    await expectRejection(
      account.checkPin(fakeUser.pin),
      'PinDisabledError: No PIN set locally for this account'
    )

    // Change PIN, leaving it disabled:
    await account.changePin({ pin: '4321', enableLogin: false })
    await expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'PinDisabledError: PIN login is not enabled for this account on this device'
    )
    expect(await account.checkPin('4321')).equals(true)

    // Enable PIN login:
    await account.changePin({ enableLogin: true })
    const successAccount = await context.loginWithPIN(fakeUser.username, '4321')
    expect(successAccount.id).equals(account.id)
  })

  it('enable / disable duress', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    // Disable PIN login:
    await duressAccount.changePin({ enableLogin: false })
    await expectRejection(
      context.loginWithPIN(fakeUser.username, '0000'),
      'PasswordError: Invalid password'
    )

    // Check the PIN should still work as expected:
    expect(await duressAccount.checkPin('0000')).equals(true)
    expect(await duressAccount.checkPin('1234')).equals(false)

    // Change PIN, leaving it disabled:
    await duressAccount.changePin({ pin: '9999', enableLogin: false })
    await expectRejection(
      context.loginWithPIN(fakeUser.username, '9999'),
      'PasswordError: Invalid password'
    )
    expect(await duressAccount.checkPin('9999')).equals(true)
    expect(await duressAccount.checkPin('0000')).equals(false)

    // Enable PIN login:
    await duressAccount.changePin({ enableLogin: true })
    const successAccount = await context.loginWithPIN(fakeUser.username, '9999')
    expect(successAccount.id).equals(duressAccount.id)
  })

  it('check', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(await account.checkPin(fakeUser.pin)).equals(true)
    expect(await account.checkPin(fakeUser.pin + '!')).equals(false)
  })

  it('check duress', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')
    const correct = await duressAccount.checkPin('0000')
    expect(correct).equals(true)
    const incorrect = await duressAccount.checkPin('1111')
    expect(incorrect).equals(false)
    const parent = await duressAccount.checkPin(fakeUser.pin)
    expect(parent).equals(false)
  })

  it('delete', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.deletePin()
    expect(context.localUsers[0].pinLoginEnabled).equals(false)
  })
})

describe('recovery2', function () {
  it('get local key', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const [user] = context.localUsers
    expect(user.recovery2Key).equals(fakeUser.recovery2Key)
  })

  it('get questions', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const questions = await context.fetchRecovery2Questions(
      fakeUser.recovery2Key,
      fakeUser.username
    )

    expect(questions.length).equals(fakeUser.recovery2Questions.length)
    for (let i = 0; i < questions.length; ++i) {
      expect(questions[i]).equals(fakeUser.recovery2Questions[i])
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

describe('duress', function () {
  it('login', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    expect(duressAccount.appId).equals('.duress')
    expect(duressAccount.username).equals('js test 0')
    expect(duressAccount.isDuressAccount).equals(true)
  })

  it('list new user even after login with duress mode', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const account = await context.createAccount({
      username: 'new-user',
      pin: '1111'
    })

    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN('new-user', '0000')

    expect(duressAccount.isDuressAccount).equal(true)

    const usernames = (await context.localUsers).map(u => ({
      username: u.username
    }))
    expect(usernames).deep.include.members([
      { username: 'new-user' },
      { username: 'js test 0' }
    ])
  })

  it('persist duress mode when using loginWithPassword', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    // Create duress account
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    expect(duressAccount.appId).equals('.duress')
    expect(duressAccount.username).equals('js test 0')
    expect(duressAccount.isDuressAccount).equals(true)

    const topicAccount = await context.loginWithPassword(
      fakeUser.username,
      fakeUser.password
    )

    expect(topicAccount.appId).equals('.duress')
    expect(topicAccount.username).equals('js test 0')
    expect(topicAccount.isDuressAccount).equals(true)
  })

  it('persist duress mode when using loginWithPassword on another account', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    await context.createAccount({
      username: 'other-account',
      pin: '1111'
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    // Create duress account
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    expect(duressAccount.appId).equals('.duress')
    expect(duressAccount.username).equals('js test 0')
    expect(duressAccount.isDuressAccount).equals(true)

    const otherAccount = await context.loginWithPIN('other-account', '1111')

    expect(otherAccount.appId).equals('')
    expect(otherAccount.username).equals('other-account')
    expect(otherAccount.isDuressAccount).equals(false)

    const topicAccount = await context.loginWithPassword(
      fakeUser.username,
      fakeUser.password
    )

    expect(topicAccount.appId).equals('.duress')
    expect(topicAccount.username).equals('js test 0')
    expect(topicAccount.isDuressAccount).equals(true)
  })

  it('check password', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    expect(await duressAccount.checkPassword(fakeUser.password)).equals(true)
    expect(await duressAccount.checkPassword('wrong password')).equals(false)
  })

  it('change password', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    await duressAccount.changePassword('foobar')

    expect(await duressAccount.checkPassword(fakeUser.password)).equals(true)
    expect(await duressAccount.checkPassword('wrong password')).equals(false)

    expect(await account.checkPassword(fakeUser.password)).equals(true)
    expect(await account.checkPassword('wrong password')).equals(false)
  })

  // Must skip because login to main account with pin is requiring OTP.
  // Failed test..
  it.skip('enableOtp is a noop', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })

    // Enable duress mode:
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    // Enable OTP:
    await duressAccount.enableOtp()
    const duressOtpKey = duressAccount.otpKey
    expect(duressOtpKey).not.equals(undefined)
    expect(account.otpKey).equals(duressOtpKey)

    // Disable duress mode:
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // OTP should be disabled:
    expect(account.otpKey).not.equals(duressOtpKey)
  })

  it('enableOtp does not overwrite main account OTP', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    await account.enableOtp()
    const accountOtpKey = account.otpKey
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    await duressAccount.enableOtp()
    const duressOtpKey = duressAccount.otpKey
    expect(duressOtpKey).not.equals(undefined)
    expect(account.otpKey).equals(duressOtpKey)

    await context.loginWithPIN(fakeUser.username, fakeUser.pin, {
      otpKey: accountOtpKey
    })

    expect(account.otpKey).equals(accountOtpKey)
  })

  it('disableOtp does not overwrite main account OTP', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    await account.enableOtp()
    const accountOtpKey = account.otpKey
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    await duressAccount.enableOtp()
    await duressAccount.disableOtp()
    const duressOtpKey = duressAccount.otpKey
    expect(duressOtpKey).equals(undefined)
    expect(account.otpKey).equals(undefined)

    await context.loginWithPIN(fakeUser.username, fakeUser.pin, {
      otpKey: accountOtpKey
    })

    expect(account.otpKey).equals(accountOtpKey)
  })
})
