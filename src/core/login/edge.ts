import { asObject, asString } from 'cleaners'
import { bridgifyObject, close, update, watchMethod } from 'yaob'

import { asBase64 } from '../../types/server-cleaners'
import {
  EdgeAccount,
  EdgeAccountOptions,
  EdgePendingEdgeLogin
} from '../../types/types'
import { makeAccount } from '../account/account-init'
import { ApiInput } from '../root-pixie'
import { makeLobby } from './lobby'
import { searchTree, syncLogin } from './login'
import { getStashById } from './login-selectors'
import { asLoginStash, LoginStash, saveStash } from './login-stash'

export interface LobbyLoginPayload {
  appId: string
  loginKey: Uint8Array
  loginStash: LoginStash
}

type WritablePendingEdgeLogin = {
  -readonly [P in keyof EdgePendingEdgeLogin]: EdgePendingEdgeLogin[P]
}

export const asLobbyLoginPayload = asObject<LobbyLoginPayload>({
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
  const { now = new Date() } = opts
  const { loginKey, loginStash: stashTree } = payload

  // For crash errors:
  ai.props.log.breadcrumb('unpackAccount', {})

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
  } catch (error: unknown) {}

  stashTree.lastLogin = now
  await saveStash(ai, stashTree)

  // This is almost guaranteed to blow up spectacularly:
  const sessionKey = {
    loginId: child.loginId,
    loginKey
  }
  await syncLogin(ai, sessionKey)
  return await makeAccount(ai, sessionKey, 'edgeLogin', opts)
}

/**
 * Creates a new account request lobby on the server.
 */
export async function requestEdgeLogin(
  ai: ApiInput,
  appId: string,
  opts: EdgeAccountOptions = {}
): Promise<EdgePendingEdgeLogin> {
  function handleSoftError(error: unknown): void {
    out.error = error
    update(out)
  }

  function handleError(error: unknown): void {
    // Stop the long-polling:
    for (const cleanup of cleanups) cleanup()

    // Update the API:
    out.state = 'error'
    out.error = error
    update(out)
    close(out)
  }

  async function handleReply(reply: unknown): Promise<void> {
    // Stop the long-polling:
    for (const cleanup of cleanups) cleanup()

    // Decode the reply:
    const payload = asLobbyLoginPayload(reply)
    const { username } = payload.loginStash
    out.state = 'started'
    out.username = username
    update(out)

    // Log in:
    const account = await unpackAccount(ai, payload, appId, opts)
    out.state = 'done'
    out.account = account
    update(out)
    close(out)
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
    lobby.on('error', handleSoftError),
    lobby.on('reply', reply => {
      handleReply(reply).catch(handleError)
    })
  ]

  const out: WritablePendingEdgeLogin = {
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
