import { base58, base64 } from '../util/encoding.js'
import { makeLobby } from './lobby.js'
import { makeLogin, searchTree } from './login.js'

/**
 * The public API for edge login requests.
 */
class ABCEdgeLoginRequest {
  constructor (lobbyId, subscription) {
    this.id = lobbyId
    this.cancelRequest = () => subscription.unsubscribe()
  }
}

/**
 * Turns a reply into a logged-in account.
 */
function onReply (io, subscription, reply, appId, opts) {
  subscription.unsubscribe()
  if (opts.onProcessLogin != null) {
    opts.onProcessLogin(reply.loginStash.username)
  }

  // Find the appropriate child:
  const child = searchTree(reply.loginStash, stash => stash.appId === appId)
  if (child == null) {
    throw new Error(`Cannot find requested appId: "${appId}"`)
  }

  // The Airbitz mobile will sometimes send the pin2Key in base58
  // instead of base64 due to an unfortunate bug. Fix that:
  if (child.pin2Key != null && child.pin2Key.slice(-1) !== '=') {
    io.log.warn('Fixing base58 pin2Key')
    child.pin2Key = base64.stringify(base58.parse(child.pin2Key))
  }
  io.loginStore.save(reply.loginStash)

  // This is almost guaranteed to blow up spectacularly:
  const login = makeLogin(reply.loginStash, base64.parse(reply.loginKey), appId)
  if (opts.onLogin != null) {
    opts.onLogin(null, login)
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
export function requestEdgeLogin (io, appId, opts) {
  const request = {
    loginRequest: {
      appId,
      displayImageUrl: opts.displayImageUrl,
      displayName: opts.displayName
    }
  }

  return makeLobby(io, request).then(lobby => {
    const subscription = lobby.subscribe(
      reply => onReply(io, subscription, reply, appId, opts),
      e => onError(lobby, e, opts)
    )
    return new ABCEdgeLoginRequest(lobby.lobbyId, subscription)
  })
}
