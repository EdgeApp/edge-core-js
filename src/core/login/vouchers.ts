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
  const { deviceDescription } = ai.props.state.login.deviceInfo

  const request = makeAuthJson(stashTree, login)
  if (deviceDescription != null) request.deviceDescription = deviceDescription
  request.data = wasChangeVouchersPayload(vouchers)

  // We would normally use `applyKit` instead of a direct fetch,
  // but we need the server to tell us what changed, not the diff:
  const reply = await loginFetch(ai, 'POST', '/v2/login/vouchers', request)
  const newStashTree = applyLoginPayload(
    stashTree,
    login.loginKey,
    asLoginPayload(reply)
  )
  return await saveStash(ai, newStashTree)
}
