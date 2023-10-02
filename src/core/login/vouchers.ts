import {
  asLoginPayload,
  wasChangeVouchersPayload
} from '../../types/server-cleaners'
import { ChangeVouchersPayload } from '../../types/server-types'
import { ApiInput } from '../root-pixie'
import { applyLoginPayload, makeAuthJson } from './login'
import { loginFetch } from './login-fetch'
import { getStashById } from './login-selectors'
import { saveStash } from './login-stash'
import { LoginTree } from './login-types'

/**
 * Approves or rejects vouchers on the server.
 */
export async function changeVoucherStatus(
  ai: ApiInput,
  login: LoginTree,
  vouchers: ChangeVouchersPayload
): Promise<void> {
  const { stashTree } = getStashById(ai, login.loginId)
  const reply = await loginFetch(ai, 'POST', '/v2/login/vouchers', {
    ...makeAuthJson(stashTree, login),
    data: wasChangeVouchersPayload(vouchers)
  })
  const newStashTree = applyLoginPayload(
    stashTree,
    login.loginKey,
    asLoginPayload(reply)
  )
  return await saveStash(ai, newStashTree)
}
