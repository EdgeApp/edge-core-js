import { uncleaner } from 'cleaners'

import { asChangeSecretPayload } from '../../types/server-cleaners'
import { encrypt } from '../../util/crypto/crypto'
import { ApiInput } from '../root-pixie'
import { LoginKit, LoginTree } from './login-types'

const wasChangeSecretPayload = uncleaner(asChangeSecretPayload)

export function makeSecretKit(
  ai: ApiInput,
  login: Pick<LoginTree, 'loginId' | 'loginKey'>
): LoginKit {
  const { io } = ai.props
  const { loginId, loginKey } = login

  const loginAuth = io.random(32)
  const loginAuthBox = encrypt(io, loginAuth, loginKey)

  return {
    login: {
      loginAuth
    },
    loginId,
    server: wasChangeSecretPayload({
      loginAuth,
      loginAuthBox
    }),
    serverPath: '/v2/login/secret',
    stash: {
      loginAuthBox
    }
  }
}
