import { uncleaner } from 'cleaners'

import { asChangeUsernamePayload } from '../../types/server-cleaners'
import { encrypt } from '../../util/crypto/crypto'
import { utf8 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'
import { hashUsername } from './login-selectors'
import { LoginKit, LoginTree } from './login-types'

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
