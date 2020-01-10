// @flow

import elliptic from 'elliptic'
import { base64 } from 'rfc4648'

import { type EdgeIo } from '../../types/types.js'
import { type JsonBox, decryptText, encrypt } from '../../util/crypto/crypto.js'
import { hmacSha256, sha256 } from '../../util/crypto/hashes.js'
import { base58, utf8 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

type Keypair = Object

// The JSON structure placed in the lobby as a reply:
export type LobbyReply = {
  publicKey: string,
  box: JsonBox
}

// The JSON structure placed in the lobby as a request:
export type LobbyRequest = {
  timeout?: number,
  publicKey?: string,
  loginRequest?: { appId: string },
  replies?: LobbyReply[]
}

export type LobbySubscription = { unsubscribe(): mixed }

// Use this to subscribe to lobby events:
export type LobbyInstance = {
  lobbyId: string,
  subscribe(
    onReply: (reply: mixed) => mixed,
    onError: (e: Error) => mixed
  ): LobbySubscription
}

/**
 * Derives a shared secret from the given secret key and public key.
 */
function deriveSharedKey(keypair: Keypair, pubkey: Uint8Array) {
  const secretX = keypair
    .derive(secp256k1.keyFromPublic(pubkey).getPublic())
    .toArray('be')

  // From NIST.SP.800-56Ar2 section 5.8.1:
  return hmacSha256([0, 0, 0, 1, ...secretX], utf8.parse('dataKey'))
}

/**
 * Decrypts a lobby reply using the request's secret key.
 */
export function decryptLobbyReply(
  keypair: Keypair,
  lobbyReply: LobbyReply
): mixed {
  const pubkey = base64.parse(lobbyReply.publicKey)
  const sharedKey = deriveSharedKey(keypair, pubkey)
  return JSON.parse(decryptText(lobbyReply.box, sharedKey))
}

/**
 * Encrypts a lobby reply JSON replyData, and returns a reply
 * suitable for sending to the server.
 */
export function encryptLobbyReply(
  io: EdgeIo,
  pubkey: Uint8Array,
  replyData: mixed
) {
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const sharedKey = deriveSharedKey(keypair, pubkey)
  return {
    publicKey: base64.stringify(keypair.getPublic().encodeCompressed()),
    box: encrypt(io, utf8.parse(JSON.stringify(replyData)), sharedKey)
  }
}

/**
 * Approximates the proposed ES `Observable` interface,
 * allowing clients to subscribe to lobby reply messages.
 */
class ObservableLobby {
  // Lobby access:
  ai: ApiInput
  lobbyId: string
  keypair: Keypair
  period: number

  // State:
  done: boolean
  replyCount: number
  timeout: TimeoutID | void

  // Callbacks:
  onError: ((e: Error) => mixed) | void
  onReply: ((reply: mixed) => mixed) | void

  constructor(ai: ApiInput, lobbyId: string, keypair: Keypair, period: number) {
    this.ai = ai
    this.lobbyId = lobbyId
    this.keypair = keypair
    this.period = period

    this.done = false
    this.replyCount = 0
    this.timeout = undefined

    this.onError = undefined
    this.onReply = undefined
  }

  subscribe(onReply: (reply: mixed) => mixed, onError: (e: Error) => mixed) {
    this.onReply = onReply
    this.onError = onError
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

function pollLobby(watcher: ObservableLobby) {
  const { ai, lobbyId, keypair, onReply, onError } = watcher

  return loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId, {})
    .then(reply => {
      // Process any new replies that have arrived on the server:
      while (watcher.replyCount < reply.replies.length) {
        const lobbyReply = reply.replies[watcher.replyCount]
        if (onReply) {
          onReply(decryptLobbyReply(keypair, lobbyReply))
        }
        ++watcher.replyCount
      }

      // Schedule another poll:
      if (!watcher.done) {
        watcher.timeout = setTimeout(() => pollLobby(watcher), watcher.period)
      }
    })
    .catch(e => {
      if (onError) onError(e)
    })
}

/**
 * Creates a new lobby on the auth server holding the given request.
 * @return A lobby watcher object that will check for incoming replies.
 */
export function makeLobby(
  ai: ApiInput,
  lobbyRequest: LobbyRequest,
  period: number = 1000
): Promise<LobbyInstance> {
  const { io } = ai.props
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const pubkey = keypair.getPublic().encodeCompressed()
  if (lobbyRequest.timeout == null) {
    lobbyRequest.timeout = 600
  }
  lobbyRequest.publicKey = base64.stringify(pubkey)

  const lobbyId = base58.stringify(sha256(sha256(pubkey)).slice(0, 10))

  const request = {
    data: lobbyRequest
  }
  return loginFetch(ai, 'PUT', '/v2/lobby/' + lobbyId, request).then(reply => {
    return new ObservableLobby(ai, lobbyId, keypair, period)
  })
}

/**
 * Fetches a lobby request from the auth server.
 * @return A promise of the lobby request JSON.
 */
export function fetchLobbyRequest(ai: ApiInput, lobbyId: string) {
  return loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId, {}).then(reply => {
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
export function sendLobbyReply(
  ai: ApiInput,
  lobbyId: string,
  lobbyRequest: LobbyRequest,
  replyData: mixed
) {
  const { io } = ai.props
  if (lobbyRequest.publicKey == null) {
    throw new TypeError('The lobby data does not have a public key')
  }
  const pubkey = base64.parse(lobbyRequest.publicKey)
  const request = {
    data: encryptLobbyReply(io, pubkey, replyData)
  }
  return loginFetch(ai, 'POST', '/v2/lobby/' + lobbyId, request).then(
    reply => null
  )
}
