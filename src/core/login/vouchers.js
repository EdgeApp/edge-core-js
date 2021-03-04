// @flow

import { asLoginPayload } from '../../types/server-cleaners.js'
import { type ChangeVouchersPayload } from '../../types/server-types.js'
import { type ApiInput } from '../root-pixie.js'
import { applyLoginPayload, makeAuthJson } from './login.js'
import { loginFetch } from './login-fetch.js'
import { getStashById } from './login-selectors.js'
import { saveStash } from './login-stash.js'
import { type LoginTree } from './login-types.js'

/**
 * Approves or rejects vouchers on the server.
 */
export async function changeVoucherStatus(
  ai: ApiInput,
  loginTree: LoginTree,
  login: LoginTree,
  vouchers: ChangeVouchersPayload
): Promise<void> {
  const { stashTree } = getStashById(ai, loginTree.loginId)
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
