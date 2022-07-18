// @flow

import { uncleaner } from 'cleaners'

import { asChangeUsernamePayload } from '../../types/server-cleaners.js'
import { encrypt } from '../../util/crypto/crypto.js'
import { utf8 } from '../../util/encoding'
import { type ApiInput } from '../root-pixie.js'
import { hashUsername } from './login-selectors'
import { type LoginKit, type LoginTree } from './login-types.js'

const wasChangeUsernamePayload = uncleaner(asChangeUsernamePayload)

export async function makeUsernameKit(
  ai: ApiInput,
  login: LoginTree,
  username: string
): Promise<LoginKit> {
  const { io } = ai.props

  const userId = await hashUsername(ai, username)

  return {
    loginId: login.loginId,
    login: { userId, username },
    server: wasChangeUsernamePayload({
      userId,
      userTextBox: encrypt(io, utf8.parse(username), login.loginKey)
    }),
    serverPath: '',
    stash: { userId, username }
  }
}
