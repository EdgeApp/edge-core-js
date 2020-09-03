// @flow

import { base64 } from 'rfc4648'
import { Bridgeable, close, emit } from 'yaob'
import { type Unsubscribe } from 'yavent'

import {
  type EdgeAccountOptions,
  type EdgePendingEdgeLogin
} from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { makeAccount } from '../account/account-init.js'
import { type ApiInput } from '../root-pixie.js'
import { makeLobby } from './lobby.js'
import { makeLoginTree, searchTree, syncLogin } from './login.js'
import { getStashById } from './login-selectors.js'
import { asLoginStash, saveStash } from './login-stash.js'

/**
 * The public API for edge login requests.
 */
class PendingEdgeLogin extends Bridgeable<EdgePendingEdgeLogin> {
  id: string
  cancelRequest: () => void

  constructor(ai: ApiInput, lobbyId: string, cleanups: Unsubscribe[]) {
    super()
    this.id = lobbyId
    this.cancelRequest = () => {
      close(this)
      cleanups.forEach(f => f())
    }

    // If the login starts, close this object:
    const offStart = ai.props.output.context.api.on('loginStart', () => {
      offStart()
      close(this)
    })
    const offError = ai.props.output.context.api.on('loginError', () => {
      offError()
      close(this)
    })
  }
}

/**
 * Turns a reply into a logged-in account.
 */
async function onReply(
  ai: ApiInput,
  reply: any,
  appId: string,
  opts: EdgeAccountOptions
): Promise<void> {
  const stashTree = asLoginStash(reply.loginStash)
  const { log } = ai.props
  const { now = new Date() } = opts

  const { username } = stashTree
  if (username == null) throw new Error('No username in reply')
  emit(ai.props.output.context.api, 'loginStart', { username })

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
  const loginKey = base64.parse(reply.loginKey)
  const loginTree = makeLoginTree(stashTree, loginKey, appId)
  const login = searchTree(loginTree, login => login.appId === appId)
  if (login == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }
  const newLoginTree = await syncLogin(ai, loginTree, login)
  const account = await makeAccount(ai, appId, newLoginTree, 'edgeLogin', opts)
  emit(ai.props.output.context.api, 'login', account)
}

/**
 * Creates a new account request lobby on the server.
 */
export function requestEdgeLogin(
  ai: ApiInput,
  appId: string,
  opts: EdgeAccountOptions = {}
): Promise<EdgePendingEdgeLogin> {
  const request = {
    loginRequest: { appId }
  }

  return makeLobby(ai, request).then(lobby => {
    function handleError(error: any): void {
      emit(ai.props.output.context.api, 'loginError', { error })
    }
    function handleReply(reply: mixed): void {
      cleanups.forEach(f => f())
      onReply(ai, reply, appId, opts).catch(handleError)
    }
    const cleanups = [
      lobby.close,
      lobby.on('error', handleError),
      lobby.on('reply', handleReply)
    ]

    return new PendingEdgeLogin(ai, lobby.lobbyId, cleanups)
  })
}
