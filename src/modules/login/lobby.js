// @flow
import {
  decrypt,
  encrypt,
  hmacSha256,
  sha256
} from '../../util/crypto/crypto.js'
import { elliptic } from '../../util/crypto/external.js'
import { base58, base64, utf8 } from '../../util/encoding.js'
import type { JsonBox } from '../login/login-types.js'
import type { CoreRoot } from '../root.js'
import { authRequest } from './authServer.js'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

// The JSON structure placed in the lobby as a reply:
export interface LobbyReply {
  publicKey: string,
  box: JsonBox
}

// The JSON structure placed in the lobby as a request:
export interface LobbyRequest {
  timeout?: number,
  publicKey?: string,
  loginRequest?: Object,
  replies?: Array<LobbyReply>
}

/**
 * Derives a shared secret from the given secret key and public key.
 */
function deriveSharedKey (keypair: any, pubkey: Uint8Array) {
  const secretX = keypair
    .derive(secp256k1.keyFromPublic(pubkey).getPublic())
    .toArray('be')

  // From NIST.SP.800-56Ar2 section 5.8.1:
  return hmacSha256([0, 0, 0, 1, ...secretX], utf8.parse('dataKey'))
}

/**
 * Decrypts a lobby reply using the request's secret key.
 */
export function decryptLobbyReply (keypair: any, lobbyReply: LobbyReply) {
  const pubkey = base64.parse(lobbyReply.publicKey)
  const sharedKey = deriveSharedKey(keypair, pubkey)
  return JSON.parse(utf8.stringify(decrypt(lobbyReply.box, sharedKey)))
}

/**
 * Encrypts a lobby reply JSON replyData, and returns a reply
 * suitable for sending to the server.
 */
export function encryptLobbyReply (io: any, pubkey: Uint8Array, replyData: {}) {
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const sharedKey = deriveSharedKey(keypair, pubkey)
  return {
    publicKey: base64.stringify(keypair.getPublic().encodeCompressed()),
    box: encrypt(io, utf8.parse(JSON.stringify(replyData)), sharedKey)
  }
}

function scheduleLobbyPoll (watcher) {
  if (!watcher.done) {
    watcher.timeout = setTimeout(() => pollLobby(watcher), watcher.period)
  }
}

function pollLobby (watcher) {
  const { coreRoot, lobbyId, keypair, onReply, onError } = watcher

  return authRequest(coreRoot, 'GET', '/v2/lobby/' + lobbyId, {})
    .then(reply => {
      while (watcher.replyCount < reply.replies.length) {
        const lobbyReply = reply.replies[watcher.replyCount]
        if (onReply) {
          onReply(decryptLobbyReply(keypair, lobbyReply))
        }
        ++watcher.replyCount
      }
      return watcher
    })
    .then(scheduleLobbyPoll)
    .catch(e => {
      if (onError) onError(e)
      return watcher
    })
}

/**
 * Approximates the proposed ES `Observable` interface,
 * allowing clients to subscribe to lobby reply messages.
 */
class ObservableLobby {
  coreRoot: CoreRoot
  done: boolean
  keypair: any
  lobbyId: string
  onError: (e: Error) => void
  onReply: (reply: Object) => void
  period: number
  replyCount: number

  constructor (coreRoot: CoreRoot, lobbyId: string, keypair) {
    this.coreRoot = coreRoot
    this.lobbyId = lobbyId
    this.keypair = keypair
  }

  subscribe (onReply, onError, period = 1000) {
    this.onReply = onReply
    this.onError = onError
    this.period = period
    this.replyCount = 0
    this.done = false
    pollLobby(this)

    const subscription = {
      unsubscribe: () => {
        this.done = true
        if (this.timeout != null) {
          clearTimeout(this.timeout)
        }
      }
    }
    return subscription
  }
}

/**
 * Creates a new lobby on the auth server holding the given request.
 * @return A lobby watcher object that will check for incoming replies.
 */
export function makeLobby (
  coreRoot: CoreRoot,
  lobbyRequest: LobbyRequest
): Promise<ObservableLobby> {
  const keypair = secp256k1.genKeyPair({ entropy: coreRoot.io.random(32) })
  const pubkey = keypair.getPublic().encodeCompressed()
  if (lobbyRequest.timeout == null) {
    lobbyRequest.timeout = 600
  }
  lobbyRequest.publicKey = base64.stringify(pubkey)

  const lobbyId = base58.stringify(sha256(sha256(pubkey)).slice(0, 10))

  const request = {
    data: lobbyRequest
  }
  return authRequest(
    coreRoot,
    'PUT',
    '/v2/lobby/' + lobbyId,
    request
  ).then(reply => {
    return new ObservableLobby(coreRoot, lobbyId, keypair)
  })
}

/**
 * Fetches a lobby request from the auth server.
 * @return A promise of the lobby request JSON.
 */
export function fetchLobbyRequest (coreRoot: CoreRoot, lobbyId: string) {
  return authRequest(
    coreRoot,
    'GET',
    '/v2/lobby/' + lobbyId,
    {}
  ).then(reply => {
    const lobbyRequest = reply.request

    // Verify the public key:
    const pubkey = base64.parse(lobbyRequest.publicKey)
    const checksum = sha256(sha256(pubkey))
    base58.parse(lobbyId).forEach((value, index) => {
      if (value !== checksum[index]) {
        throw new Error('Lobby ECDH integrity error')
      }
    })

    return lobbyRequest
  })
}

/**
 * Encrypts and sends a reply to a lobby request.
 */
export function sendLobbyReply (
  coreRoot: CoreRoot,
  lobbyId: string,
  lobbyRequest: LobbyRequest,
  replyData: Object
) {
  if (lobbyRequest.publicKey == null) {
    throw new TypeError('The lobby data does not have a public key')
  }
  const pubkey = base64.parse(lobbyRequest.publicKey)
  const request = {
    data: encryptLobbyReply(coreRoot.io, pubkey, replyData)
  }
  return authRequest(coreRoot, 'POST', '/v2/lobby/' + lobbyId, request).then(
    reply => null
  )
}
