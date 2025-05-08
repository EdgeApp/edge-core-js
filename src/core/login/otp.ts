import { base32 } from 'rfc4648'

import {
  asOtpResetPayload,
  wasChangeOtpPayload
} from '../../types/server-cleaners'
import { EdgeAccountOptions } from '../../types/types'
import { totp } from '../../util/crypto/hotp'
import { applyKit, serverLogin } from '../login/login'
import { ApiInput } from '../root-pixie'
import { loginFetch } from './login-fetch'
import { getStashById, hashUsername } from './login-selectors'
import { LoginStash, saveStash } from './login-stash'
import { LoginKit, LoginTree } from './login-types'

/**
 * Gets the current OTP for a logged-in account.
 */
export function getLoginOtp(login: LoginTree): string | undefined {
  if (login.otpKey != null) return totp(login.otpKey)
}

/**
 * Gets the current OTP from either the disk storage or login options.
 */
export function getStashOtp(
  stash: LoginStash,
  opts: EdgeAccountOptions
): string | undefined {
  const { otp, otpKey } = opts
  if (otp != null) return otp
  if (otpKey != null) return totp(base32.parse(otpKey, { loose: true }))
  if (stash.otpKey != null) return totp(stash.otpKey)
}

export async function enableOtp(
  ai: ApiInput,
  accountId: string,
  otpTimeout: number
): Promise<void> {
  const { loginTree, sessionKey } = ai.props.state.accounts[accountId]
  const { otpKey = ai.props.io.random(10) } = loginTree

  const kit: LoginKit = {
    loginId: loginTree.loginId,
    server: wasChangeOtpPayload({
      otpKey,
      otpTimeout
    }),
    serverPath: '/v2/login/otp',
    stash: {
      otpKey,
      otpResetDate: undefined,
      otpTimeout
    }
  }
  await applyKit(ai, sessionKey, kit)
}

/**
 * Enable a temporary OTP key.
 * This is used when we're in duress mode.
 * @param ai - The API input.
 * @param accountId - The account ID.
 */
export async function enableTempOtp(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { stashTree } = ai.props.state.accounts[accountId]
  const otpKey = ai.props.io.random(10)

  await saveStash(ai, { ...stashTree, otpKey })
}

export async function disableOtp(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree, sessionKey } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    loginId: loginTree.loginId,
    server: undefined,
    serverMethod: 'DELETE',
    serverPath: '/v2/login/otp',
    stash: {
      otpKey: undefined,
      otpResetDate: undefined,
      otpTimeout: undefined
    }
  }
  await applyKit(ai, sessionKey, kit)
}

/**
 * Disable a temporary OTP key.
 * This is used when we're in duress mode.
 * @param ai - The API input.
 * @param accountId - The account ID.
 */
export async function disableTempOtp(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { stashTree } = ai.props.state.accounts[accountId]
  await saveStash(ai, { ...stashTree, otpKey: undefined })
}

export async function cancelOtpReset(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree, sessionKey } = ai.props.state.accounts[accountId]
  const { otpTimeout, otpKey } = loginTree
  if (otpTimeout == null || otpKey == null) {
    throw new Error('Cannot cancel 2FA reset: 2FA is not enabled.')
  }

  const kit: LoginKit = {
    loginId: loginTree.loginId,
    server: wasChangeOtpPayload({
      otpTimeout,
      otpKey
    }),
    serverPath: '/v2/login/otp',
    stash: {
      otpResetDate: undefined
    }
  }
  await applyKit(ai, sessionKey, kit)
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
    userId: await hashUsername(ai, username),
    otpResetAuth: resetToken
  }
  const reply = await loginFetch(ai, 'DELETE', '/v2/login/otp', request)
  const { otpResetDate } = asOtpResetPayload(reply)
  return otpResetDate
}

/**
 * If the device doesn't have the right OTP key,
 * this can prevent most things from working.
 * Let the user provide an updated key, and present that to the server.
 * If the key works, the server will let us in & resolve the issue.
 */
export async function repairOtp(
  ai: ApiInput,
  accountId: string,
  otpKey: Uint8Array
): Promise<void> {
  if (ai.props.state.accounts[accountId] == null) return
  const { login } = ai.props.state.accounts[accountId]
  const { userId, passwordAuth } = login

  const { stashTree, stash } = getStashById(ai, login.loginId)
  if (passwordAuth == null || userId == null) {
    throw new Error('Cannot repair OTP: There is no password on this account')
  }
  const request = {
    userId,
    passwordAuth,
    otp: totp(otpKey)
  }
  const opts: EdgeAccountOptions = {
    // Avoid updating the lastLogin date:
    now: stashTree.lastLogin
  }
  await serverLogin(ai, stashTree, stash, opts, request, async () => {
    return login.loginKey
  })
}
