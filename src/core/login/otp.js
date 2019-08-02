// @flow

import { base32 } from 'rfc4648'

import { fixOtpKey } from '../../util/crypto/hotp.js'
import { applyKit } from '../login/login.js'
import { type ApiInput } from '../root-pixie.js'
import { type LoginKit } from './login-types.js'

export async function enableOtp (
  ai: ApiInput,
  accountId: string,
  otpTimeout: number
) {
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
      otpResetDate: void 0,
      otpTimeout
    },
    login: {
      otpKey,
      otpResetDate: void 0,
      otpTimeout
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function disableOtp (ai: ApiInput, accountId: string) {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
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
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

export async function cancelOtpReset (ai: ApiInput, accountId: string) {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    serverPath: '/v2/login/otp',
    server: {
      otpTimeout: loginTree.otpTimeout,
      otpKey: loginTree.otpKey
    },
    stash: {
      otpResetDate: void 0
    },
    login: {
      otpResetDate: void 0
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}
