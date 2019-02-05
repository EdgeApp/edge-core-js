// @flow

import { base32 } from 'rfc4648'

import { fixOtpKey } from '../../util/crypto/hotp.js'
import { applyKit } from '../login/login.js'
import { type ApiInput } from '../root-pixie.js'

export async function enableOtp (
  ai: ApiInput,
  accountId: string,
  otpTimeout: number
) {
  const { login, loginTree } = ai.props.state.accounts[accountId]

  const otpKey =
    login.otpKey != null
      ? fixOtpKey(login.otpKey)
      : base32.stringify(ai.props.io.random(10))

  const kit = {
    serverPath: '/v2/login/otp',
    server: {
      otpKey,
      otpTimeout
    },
    stash: {
      otpKey,
      otpResetDate: void 0,
      otpTimeout
    },
    login: {
      otpKey,
      otpResetDate: void 0,
      otpTimeout
    },
    loginId: login.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function disableOtp (ai: ApiInput, accountId: string) {
  const { login, loginTree } = ai.props.state.accounts[accountId]

  const kit = {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/otp',
    stash: {
      otpKey: void 0,
      otpResetDate: void 0,
      otpTimeout: void 0
    },
    login: {
      otpKey: void 0,
      otpResetDate: void 0,
      otpTimeout: void 0
    },
    loginId: login.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function cancelOtpReset (ai: ApiInput, accountId: string) {
  const { login, loginTree } = ai.props.state.accounts[accountId]

  const kit = {
    serverPath: '/v2/login/otp',
    server: {
      otpTimeout: login.otpTimeout,
      otpKey: login.otpKey
    },
    stash: {
      otpResetDate: void 0
    },
    login: {
      otpResetDate: void 0
    },
    loginId: login.loginId
  }
  await applyKit(ai, loginTree, kit)
}
