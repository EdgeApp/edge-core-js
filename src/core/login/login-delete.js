// @flow

import { type ApiInput } from '../root-pixie.js'
import { makeAuthJson } from './login.js'
import { loginFetch } from './login-fetch.js'
import { getStashById } from './login-selectors.js'
import { type LoginTree } from './login-types.js'

/**
 * Deletes a login from the server.
 */
export async function deleteLogin(
  ai: ApiInput,
  login: LoginTree
): Promise<void> {
  const { stashTree } = getStashById(ai, login.loginId)
  await loginFetch(
    ai,
    'POST',
    '/v2/login/delete',
    makeAuthJson(stashTree, login)
  )
}
