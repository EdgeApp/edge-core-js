// @flow

import { base32, base64 } from 'rfc4648'

import { asOtpResetPayload } from '../../types/server-cleaners.js'
import { type EdgeAccountOptions } from '../../types/types.js'
import { fixOtpKey, totp } from '../../util/crypto/hotp.js'
import { applyKit } from '../login/login.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'
import { hashUsername } from './login-selectors.js'
import { type LoginStash } from './login-stash.js'
import { type LoginKit, type LoginTree } from './login-types.js'

/**
 * Gets the current OTP for a logged-in account.
 */
export function getLoginOtp(login: LoginTree): string | void {
  if (login.otpKey != null) return totp(login.otpKey)
}

/**
 * Gets the current OTP from either the disk storage or login options.
 */
export function getStashOtp(
  stash: LoginStash,
  opts: EdgeAccountOptions
): string | void {
  const { otp, otpKey = stash.otpKey } = opts
  if (otp != null) {
    if (/[0-9]+/.test(otp) && otp.length < 16) return otp
    return totp(otp)
  }
  if (otpKey != null) return totp(otpKey)
}

export async function enableOtp(
  ai: ApiInput,
  accountId: string,
  otpTimeout: number
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const otpKey =
    loginTree.otpKey != null
      ? fixOtpKey(loginTree.otpKey)
      : base32.stringify(ai.props.io.random(10))

  const kit: LoginKit = {
    serverPath: '/v2/login/otp',
    server: {
      otpKey,
      otpTimeout
    },
    stash: {
      otpKey,
      otpResetDate: undefined,
      otpTimeout
    },
    login: {
      otpKey,
      otpResetDate: undefined,
      otpTimeout
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function disableOtp(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/otp',
    stash: {
      otpKey: undefined,
      otpResetDate: undefined,
      otpTimeout: undefined
    },
    login: {
      otpKey: undefined,
      otpResetDate: undefined,
      otpTimeout: undefined
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function cancelOtpReset(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    serverPath: '/v2/login/otp',
    server: {
      otpTimeout: loginTree.otpTimeout,
      otpKey: loginTree.otpKey
    },
    stash: {
      otpResetDate: undefined
    },
    login: {
      otpResetDate: undefined
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

/**
 * Requests an OTP reset.
 */
export async function resetOtp(
  ai: ApiInput,
  username: string,
  resetToken: string
): Promise<Date> {
  const request = {
    userId: base64.stringify(await hashUsername(ai, username)),
    otpResetAuth: resetToken
  }
  return loginFetch(ai, 'DELETE', '/v2/login/otp', request).then(reply => {
    const { otpResetDate } = asOtpResetPayload(reply)
    return otpResetDate
  })
}
