// @flow

import { base58, base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { makeLobby } from './lobby.js'
import type { LoginTree } from './login-types.js'
import { makeLoginTree, searchTree, syncLogin } from './login.js'

/**
 * The public API for edge login requests.
 */
class ABCEdgeLoginRequest {
  id: string
  cancelRequest: () => void

  constructor (lobbyId, subscription) {
    this.id = lobbyId
    this.cancelRequest = () => subscription.unsubscribe()
  }
}

/**
 * Turns a reply into a logged-in account.
 */
function onReply (ai: ApiInput, subscription, reply, appId, opts) {
  subscription.unsubscribe()
  const stashTree = reply.loginStash
  const { io, loginStore } = ai.props

  if (opts.onProcessLogin != null) {
    opts.onProcessLogin(stashTree.username)
  }

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
  loginStore.save(stashTree)

  // This is almost guaranteed to blow up spectacularly:
  const loginKey = base64.parse(reply.loginKey)
  const loginTree = makeLoginTree(stashTree, loginKey, appId)
  if (opts.onLogin != null) {
    const login = searchTree(loginTree, login => login.appId === appId)
    if (login == null) {
      throw new Error(`Cannot find requested appId: "${appId}"`)
    }
    syncLogin(ai, loginTree, login)
      .then(loginTree => {
        opts.onLogin(void 0, loginTree)
      })
      .catch(e => {
        if (opts.onLogin != null) {
          opts.onLogin(e)
        }
      })
  }
}

function onError (lobby, e, opts) {
  if (opts.onLogin != null) {
    opts.onLogin(e)
  }
}

/**
 * Creates a new account request lobby on the server.
 */
export function requestEdgeLogin (
  ai: ApiInput,
  appId: string,
  opts: {
    displayImageUrl: ?string,
    displayName: ?string,
    onProcessLogin?: (username: string) => mixed,
    onLogin(e?: Error, loginTree?: LoginTree): mixed
  }
) {
  const request = {
    loginRequest: {
      appId,
      displayImageUrl: opts.displayImageUrl,
      displayName: opts.displayName
    }
  }

  return makeLobby(ai, request).then(lobby => {
    const subscription = lobby.subscribe(
      reply => onReply(ai, subscription, reply, appId, opts),
      e => onError(lobby, e, opts)
    )
    return new ABCEdgeLoginRequest(lobby.lobbyId, subscription)
  })
}
