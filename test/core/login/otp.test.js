// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import {
  type EdgeAccount,
  type EdgeContext,
  asMaybeOtpError
} from '../../../src/types/types.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

/**
 * Creates two virtual phones, a local one that has logged in,
 * and a remote one that has just failed OTP login.
 * Returns the OTP reset token & voucher ID associated with the failure.
 */
async function setupOtpFailure(
  opts: { now: Date } = {}
): Promise<{
  // Logged-in device:
  account: EdgeAccount,
  context: EdgeContext,
  // Failed device:
  remote: EdgeContext,
  resetToken: string,
  voucherId: string
}> {
  const { now = new Date() } = opts

  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext(contextOptions)
  const remote = await world.makeEdgeContext({
    ...contextOptions,
    cleanDevice: true
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  // Perform a failed remote login:
  const error: mixed = await remote
    .loginWithRecovery2(
      fakeUser.recovery2Key,
      fakeUser.username,
      fakeUser.recovery2Answers,
      { now }
    )
    .catch(error => error)

  const otpError = asMaybeOtpError(error)
  if (otpError == null) throw new Error('Expected an OtpError')
  const { resetToken, voucherId } = otpError
  if (resetToken == null) throw new Error('Expected a resetToken')
  if (voucherId == null) throw new Error('Expected a voucherId')

  return { account, context, remote, resetToken, voucherId }
}

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
    await context.loginWithRecovery2(
      fakeUser.recovery2Key,
      fakeUser.username,
      fakeUser.recovery2Answers
    )
  })

  it('failed users still appear', async function () {
    const now = new Date()
    const { remote, voucherId } = await setupOtpFailure({ now })

    // The login fails, but the username still appears:
    expect(remote.localUsers).deep.equals([
      {
        keyLoginEnabled: false,
        lastLogin: now,
        pinLoginEnabled: false,
        recovery2Key: undefined,
        username: 'js test 0',
        voucherId
      }
    ])
  })

  it('backup key works', async function () {
    const { account, remote } = await setupOtpFailure()

    await remote.loginWithPassword(fakeUser.username, fakeUser.password, {
      otpKey: account.otpKey
    })
  })

  it('resets can be cancelled', async function () {
    const { account, context, remote, resetToken } = await setupOtpFailure()

    // Request a reset:
    await remote.requestOtpReset(fakeUser.username, resetToken)

    // Verify that a reset has been requested:
    const messages1 = await context.fetchLoginMessages()
    expect(messages1['js test 0'].otpResetPending).equals(true)

    // Cancel the reset:
    await account.cancelOtpReset()
    const messages2 = await context.fetchLoginMessages()
    expect(messages2['js test 0'].otpResetPending).equals(false)
  })
})
