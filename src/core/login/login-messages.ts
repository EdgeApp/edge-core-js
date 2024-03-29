import { base64 } from 'rfc4648'

import { asMessagesPayload } from '../../types/server-cleaners'
import { EdgeLoginMessage } from '../../types/types'
import { ApiInput } from '../root-pixie'
import { loginFetch } from './login-fetch'

/**
 * Fetches any login-related messages for all the users on this device.
 */
export async function fetchLoginMessages(
  ai: ApiInput
): Promise<EdgeLoginMessage[]> {
  const { stashes } = ai.props.state.login

  const loginMap: { [loginId: string]: string } = {} // loginId -> username
  const loginIds: Uint8Array[] = []
  for (const stash of stashes) {
    const { loginId, username } = stash
    if (username == null) continue
    loginMap[base64.stringify(loginId)] = username
    loginIds.push(loginId)
  }

  const request = {
    loginIds
  }
  const reply = await loginFetch(ai, 'POST', '/v2/messages', request)
  const out: EdgeLoginMessage[] = []
  for (const message of asMessagesPayload(reply)) {
    const { loginId, ...rest } = message
    const id = base64.stringify(loginId)
    const username = loginMap[id]
    if (username == null) continue
    out.push({ ...rest, loginId: id, username })
  }
  return out
}
