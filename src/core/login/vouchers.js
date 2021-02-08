// @flow

import { type ApiInput } from '../root-pixie.js'
import { applyLoginPayload, makeAuthJson } from './login.js'
import { loginFetch } from './login-fetch.js'
import { asLoginPayload } from './login-reply.js'
import { getStash } from './login-selectors.js'
import { saveStash } from './login-stash.js'
import { type LoginTree } from './login-types.js'

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
  const newStashTree = applyLoginPayload(
    stashTree,
    login.loginKey,
    asLoginPayload(reply)
  )
  return saveStash(ai, newStashTree)
}
