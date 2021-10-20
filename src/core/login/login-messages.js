// @flow

import { base64 } from 'rfc4648'

import { asMessagesPayload } from '../../types/server-cleaners.js'
import { type EdgeLoginMessages } from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'

/**
 * Fetches any login-related messages for all the users on this device.
 */
export function fetchLoginMessages(ai: ApiInput): Promise<EdgeLoginMessages> {
  const stashes = ai.props.state.login.stashes

  const loginMap: { [loginId: string]: string } = {} // loginId -> username
  const loginIds: Uint8Array[] = []
  for (const username of Object.keys(stashes)) {
    const loginId = stashes[username].loginId
    if (loginId != null) {
      loginMap[base64.stringify(loginId)] = username
      loginIds.push(loginId)
    }
  }

  const request = {
    loginIds
  }
  return loginFetch(ai, 'POST', '/v2/messages', request).then(reply => {
    const out: EdgeLoginMessages = {}
    for (const message of asMessagesPayload(reply)) {
      const { loginId, ...rest } = message
      const id = base64.stringify(loginId)
      const username = loginMap[id]
      if (username != null) out[username] = { ...rest, loginId: id }
    }
    return out
  })
}
