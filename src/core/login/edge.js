// @flow

import { base64 } from 'rfc4648'
import { Bridgeable, close, emit } from 'yaob'

import {
  type EdgeEdgeLoginOptions,
  type EdgePendingEdgeLogin
} from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { makeAccount } from '../account/account-init.js'
import { type ApiInput } from '../root-pixie.js'
import { makeLobby } from './lobby.js'
import { makeLoginTree, searchTree, syncLogin } from './login.js'
import { saveStash } from './loginStore.js'

/**
 * The public API for edge login requests.
 */
class PendingEdgeLogin extends Bridgeable<EdgePendingEdgeLogin> {
  id: string
  cancelRequest: () => void

  constructor (ai, lobbyId, subscription) {
    super()
    this.id = lobbyId
    this.cancelRequest = () => {
      close(this)
      subscription.unsubscribe()
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
async function onReply (ai: ApiInput, subscription, reply, appId, opts) {
  subscription.unsubscribe()
  const stashTree = reply.loginStash
  const { io } = ai.props

  emit(ai.props.output.context.api, 'loginStart', {
    username: stashTree.username
  })

  // Find the appropriate child:
  const child = searchTree(stashTree, stash => stash.appId === appId)
  if (child == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }

  // The Airbitz mobile will sometimes send the pin2Key in base58
  // instead of base64 due to an unfortunate bug. Fix that:
  if (child.pin2Key != null && child.pin2Key.slice(-1) !== '=') {
    io.console.warn('Fixing base58 pin2Key')
    child.pin2Key = base64.stringify(base58.parse(child.pin2Key))
  }
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
export function requestEdgeLogin (
  ai: ApiInput,
  appId: string,
  opts: EdgeEdgeLoginOptions
): Promise<EdgePendingEdgeLogin> {
  const request = {
    loginRequest: {
      appId,
      displayImageUrl: opts.displayImageUrl,
      displayName: opts.displayName
    }
  }

  return makeLobby(ai, request).then(lobby => {
    const subscription = lobby.subscribe(
      reply => {
        try {
          onReply(ai, subscription, reply, appId, opts)
        } catch (e) {
          emit(ai.props.output.context.api, 'loginError', { e })
        }
      },
      error => emit(ai.props.output.context.api, 'loginError', { error })
    )
    return new PendingEdgeLogin(ai, lobby.lobbyId, subscription)
  })
}
