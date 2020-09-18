// @flow

import { type ApiInput } from '../root-pixie'
import { applyLoginReply, makeAuthJson } from './login'
import { loginFetch } from './login-fetch'
import { asLoginReply } from './login-reply'
import { getStash } from './login-selectors'
import { saveStash } from './login-stash'
import { type LoginTree } from './login-types'

/**
 * Approves or rejects vouchers on the server.
 */
export async function changeVoucherStatus(
  ai: ApiInput,
  loginTree: LoginTree,
  login: LoginTree,
  vouchers: {
    approvedVouchers?: string[],
    rejectedVouchers?: string[]
  }
): Promise<void> {
  if (loginTree.username == null) {
    throw new Error('Cannot sync: missing username')
  }

  const stashTree = getStash(ai, loginTree.username)
  const reply = await loginFetch(ai, 'POST', '/v2/login/vouchers', {
    ...makeAuthJson(stashTree, login),
    data: vouchers
  })
  const newStashTree = applyLoginReply(
    stashTree,
    login.loginKey,
    asLoginReply(reply)
  )
  return saveStash(ai, newStashTree)
}
