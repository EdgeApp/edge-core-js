import { ApiInput } from '../root-pixie'
import { makeAuthJson } from './login'
import { loginFetch } from './login-fetch'
import { getStashById } from './login-selectors'
import { LoginTree } from './login-types'

/**
 * Deletes a login from the server.
 */
export async function deleteLogin(
  ai: ApiInput,
  login: LoginTree
): Promise<void> {
  const { stashTree } = getStashById(ai, login.loginId)
  const { deviceDescription } = ai.props.state.login

  const request = makeAuthJson(stashTree, login)
  if (deviceDescription != null) request.deviceDescription = deviceDescription

  await loginFetch(ai, 'POST', '/v2/login/delete', request)
}
