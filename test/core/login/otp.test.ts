import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index'
import {
  asMaybeOtpError,
  EdgeAccount,
  EdgeContext
} from '../../../src/types/types'
import { expectRejection } from '../../expect-rejection'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

/**
 * Creates two virtual phones, a local one that has logged in,
 * and a remote one that has just failed OTP login.
 * Returns the OTP reset token & voucher ID associated with the failure.
 */
async function setupOtpFailure(
  opts: { appId?: string; now?: Date } = {}
): Promise<{
  // Logged-in device:
  account: EdgeAccount
  context: EdgeContext
  // Failed device:
  remote: EdgeContext
  resetToken: string
  voucherId: string
}> {
  const { appId = '', now = new Date() } = opts

  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({ ...contextOptions, appId })
  const remote = await world.makeEdgeContext({
    ...contextOptions,
    appId,
    cleanDevice: true
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  // Perform a failed remote login:
  const error: unknown = await remote
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
        loginId: 'BTnpEn7pabDXbcv7VxnKBDsn4CVSwLRA25J8U84qmg4h',
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

  it('vouchers can be approved', async function () {
    const { account, context, remote, voucherId } = await setupOtpFailure()

    // The voucher should appear in the messages:
    const messages1 = await context.fetchLoginMessages()
    expect(messages1['js test 0'].pendingVouchers.length).equals(1)
    expect(messages1['js test 0'].pendingVouchers[0].voucherId).equals(
      voucherId
    )

    // Approve the voucher:
    await account.approveVoucher(voucherId)

    // The voucher should not appear in the messages:
    const messages2 = await context.fetchLoginMessages()
    expect(messages2['js test 0'].pendingVouchers.length).equals(0)

    // Remote login should work now:
    await remote.loginWithPassword(fakeUser.username, fakeUser.password)
  })

  it('vouchers can be rejected', async function () {
    const { account, context, remote, voucherId } = await setupOtpFailure()

    // Reject the voucher:
    await account.rejectVoucher(voucherId)

    // The voucher should not appear in the messages:
    const messages2 = await context.fetchLoginMessages()
    expect(messages2['js test 0'].pendingVouchers.length).equals(0)

    // Remote login should not work:
    await expectRejection(
      remote.loginWithPassword(fakeUser.username, fakeUser.password)
    )
  })

  it('vouchers can be approved with appId', async function () {
    const { account, context, remote, voucherId } = await setupOtpFailure({
      appId: 'test-child'
    })

    // The voucher should appear in the messages:
    const messages1 = await context.fetchLoginMessages()
    expect(messages1['js test 0'].pendingVouchers.length).equals(1)
    expect(messages1['js test 0'].pendingVouchers[0].voucherId).equals(
      voucherId
    )

    // Approve the voucher:
    await account.approveVoucher(voucherId)

    // The voucher should not appear in the messages:
    const messages2 = await context.fetchLoginMessages()
    expect(messages2['js test 0'].pendingVouchers.length).equals(0)

    // Remote login should work now:
    await remote.loginWithPassword(fakeUser.username, fakeUser.password)
  })
})
