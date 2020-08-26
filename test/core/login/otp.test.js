// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { errorNames, makeFakeEdgeWorld } from '../../../src/index.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('otp', function () {
  it('local login works', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account.otpKey != null).equals(true)
    await account.disableOtp()
    expect(account.otpKey == null).equals(true)
    await account.enableOtp()
    expect(account.otpKey != null).equals(true)

    // Can still log in locally:
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('remote login fails', async function () {
    const now = new Date()
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const remote = await world.makeEdgeContext({
      ...contextOptions,
      cleanDevice: true
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Cannot log in remotely:
    await remote
      .loginWithPassword(fakeUser.username, fakeUser.password, { now })
      .then(
        () => {
          throw new Error('First-time 2fa logins should fail')
        },
        error => {
          expect(error.name).equals(errorNames.OtpError)
          expect(remote.localUsers.length).equals(1)
          return context.requestOtpReset(fakeUser.username, error.resetToken)
        }
      )

    // The login fails, but the username still appears:
    expect(remote.localUsers).deep.equals([
      {
        keyLoginEnabled: false,
        lastLogin: now,
        pinLoginEnabled: false,
        recovery2Key: undefined,
        username: 'js test 0'
      }
    ])

    // Can log in remotely with the token:
    await remote.loginWithPassword(fakeUser.username, fakeUser.password, {
      otpKey: account.otpKey
    })

    // Verify that a reset has been requested:
    const messages1 = await context.fetchLoginMessages()
    expect(messages1['js test 0'].otpResetPending).equals(true)

    // Cancel the reset:
    await account.cancelOtpReset()
    const messages2 = await context.fetchLoginMessages()
    expect(messages2['js test 0'].otpResetPending).equals(false)
  })
})
