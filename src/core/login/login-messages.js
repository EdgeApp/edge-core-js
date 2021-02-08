// @flow

import {
  type Cleaner,
  asArray,
  asBoolean,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import {
  type EdgeLoginMessage,
  type EdgeLoginMessages
} from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'
import { asPendingVoucher } from './login-types.js'

/**
 * Fetches any login-related messages for all the users on this device.
 */
export function fetchLoginMessages(ai: ApiInput): Promise<EdgeLoginMessages> {
  const stashes = ai.props.state.login.stashes

  const loginMap: { [loginId: string]: string } = {} // loginId -> username
  for (const username of Object.keys(stashes)) {
    const loginId = stashes[username].loginId
    if (loginId != null) loginMap[loginId] = username
  }

  const request = {
    loginIds: Object.keys(loginMap)
  }
  return loginFetch(ai, 'POST', '/v2/messages', request).then(reply => {
    const out: EdgeLoginMessages = {}
    for (const message of asMessagesPayload(reply)) {
      const username = loginMap[message.loginId]
      if (username != null) out[username] = message
    }
    return out
  })
}

const asLoginMessage: Cleaner<EdgeLoginMessage> = asObject({
  loginId: asString,
  otpResetPending: asOptional(asBoolean, false),
  pendingVouchers: asOptional(asArray(asPendingVoucher), []),
  recovery2Corrupt: asOptional(asBoolean, false)
})

const asMessagesPayload = asArray(asLoginMessage)
