// @flow

import { type Cleaner, asObject, asString } from 'cleaners'
import { base64 } from 'rfc4648'
import { bridgifyObject, close, emit, update, watchMethod } from 'yaob'

import { asBase64 } from '../../types/server-cleaners.js'
import {
  type EdgeAccount,
  type EdgeAccountOptions,
  type EdgePendingEdgeLogin
} from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { makeAccount } from '../account/account-init.js'
import { type ApiInput } from '../root-pixie.js'
import { makeLobby } from './lobby.js'
import { makeLoginTree, searchTree, syncLogin } from './login.js'
import { getStashById } from './login-selectors.js'
import { type LoginStash, asLoginStash, saveStash } from './login-stash.js'

export type LobbyLoginPayload = {
  appId: string,
  loginKey: Uint8Array,
  loginStash: LoginStash
}

export const asLobbyLoginPayload: Cleaner<LobbyLoginPayload> = asObject({
  appId: asString,
  loginKey: asBase64,
  loginStash: asLoginStash
})

/**
 * Turns a reply into a logged-in account.
 */
async function unpackAccount(
  ai: ApiInput,
  payload: LobbyLoginPayload,
  appId: string,
  opts: EdgeAccountOptions
): Promise<EdgeAccount> {
  const { log } = ai.props
  const { now = new Date() } = opts
  const { loginKey, loginStash: stashTree } = payload

  // Find the appropriate child:
  const child = searchTree(stashTree, stash => stash.appId === appId)
  if (child == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }

  // Rescue any existing vouchers:
  try {
    const old = getStashById(ai, child.loginId)
    child.voucherId = old.stash.voucherId
    child.voucherAuth = old.stash.voucherAuth
  } catch (error) {}

  // The Airbitz mobile will sometimes send the pin2Key in base58
  // instead of base64 due to an unfortunate bug. Fix that:
  const { pin2Key } = child
  if (pin2Key != null && pin2Key.slice(-1) !== '=') {
    log.warn('Fixing base58 pin2Key')
    child.pin2Key = base64.stringify(base58.parse(pin2Key))
  }
  stashTree.lastLogin = now
  await saveStash(ai, stashTree)

  // This is almost guaranteed to blow up spectacularly:
  const loginTree = makeLoginTree(stashTree, loginKey, appId)
  const login = searchTree(loginTree, login => login.appId === appId)
  if (login == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }
  const newLoginTree = await syncLogin(ai, loginTree, login)
  return await makeAccount(ai, appId, newLoginTree, 'edgeLogin', opts)
}

/**
 * Creates a new account request lobby on the server.
 */
export async function requestEdgeLogin(
  ai: ApiInput,
  appId: string,
  opts: EdgeAccountOptions = {}
): Promise<EdgePendingEdgeLogin> {
  function handleError(error: mixed): void {
    // Stop the long-polling:
    for (const cleanup of cleanups) cleanup()

    // Update the API:
    out.state = 'error'
    out.error = error
    update(out)
    close(out)
    emit(ai.props.output.context.api, 'loginError', { error })
  }

  async function handleReply(reply: mixed): Promise<void> {
    // Stop the long-polling:
    for (const cleanup of cleanups) cleanup()

    // Decode the reply:
    const payload = asLobbyLoginPayload(reply)
    const { username } = payload.loginStash
    if (username == null) throw new Error('No username in reply')
    out.state = 'started'
    out.username = username
    update(out)
    emit(ai.props.output.context.api, 'loginStart', { username })

    // Log in:
    const account = await unpackAccount(ai, payload, appId, opts)
    out.state = 'done'
    out.account = account
    update(out)
    close(out)
    emit(ai.props.output.context.api, 'login', account)
  }

  async function cancelRequest(): Promise<void> {
    // Stop the long-polling:
    for (const cleanup of cleanups) cleanup()

    // Update the API:
    out.state = 'closed'
    update(out)
    close(out)
  }

  const lobby = await makeLobby(ai, { loginRequest: { appId } })
  const cleanups = [
    lobby.close,
    lobby.on('error', handleError),
    lobby.on('reply', reply => handleReply(reply).catch(handleError))
  ]

  const out = {
    id: lobby.lobbyId,
    cancelRequest,
    watch: watchMethod,

    state: 'pending',
    account: undefined,
    error: undefined,
    username: undefined
  }
  return bridgifyObject(out)
}
