// @flow

import elliptic from 'elliptic'
import { base64 } from 'rfc4648'

import { type EdgeIo } from '../../types/types.js'
import { type EdgeBox, decryptText, encrypt } from '../../util/crypto/crypto.js'
import { hmacSha256, sha256 } from '../../util/crypto/hashes.js'
import { base58, utf8 } from '../../util/encoding.js'
import {
  type PeriodicTask,
  makePeriodicTask
} from '../../util/periodic-task.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

type Keypair = Object

// The JSON structure placed in the lobby as a reply:
export type LobbyReply = {
  publicKey: string,
  box: EdgeBox
}

// The JSON structure placed in the lobby as a request:
export type LobbyRequest = {
  timeout?: number,
  publicKey?: string,
  loginRequest?: { appId: string },
  replies?: LobbyReply[]
}

export type LobbySubscription = { unsubscribe(): void }

// Use this to subscribe to lobby events:
export type LobbyInstance = {
  lobbyId: string,
  subscribe(
    onReply: (reply: mixed) => void,
    onError: (e: Error) => void
  ): LobbySubscription
}

/**
 * Derives a shared secret from the given secret key and public key.
 */
function deriveSharedKey(keypair: Keypair, pubkey: Uint8Array): Uint8Array {
  const secretX = keypair
    .derive(secp256k1.keyFromPublic(pubkey).getPublic())
    .toArray('be')

  // From NIST.SP.800-56Ar2 section 5.8.1:
  return hmacSha256(
    Uint8Array.from([0, 0, 0, 1, ...secretX]),
    utf8.parse('dataKey')
  )
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
): LobbyReply {
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
  lobbyId: string
  replyCount: number
  task: PeriodicTask

  // Callbacks:
  onError: ((e: Error) => void) | void
  onReply: ((reply: mixed) => void) | void

  constructor(ai: ApiInput, lobbyId: string, keypair: Keypair, period: number) {
    const pollLobby = async () => {
      const reply = await loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId, {})

      // Process any new replies that have arrived on the server:
      while (this.replyCount < reply.replies.length) {
        const lobbyReply = reply.replies[this.replyCount]
        const decrypted = decryptLobbyReply(keypair, lobbyReply)
        const { onReply } = this
        if (onReply != null) onReply(decrypted)
        ++this.replyCount
      }
    }

    this.onError = undefined
    this.onReply = undefined
    this.lobbyId = lobbyId
    this.replyCount = 0
    this.task = makePeriodicTask(pollLobby, period, {
      onError: error => {
        const { onError } = this
        if (onError != null && error instanceof Error) onError(error)
      }
    })
  }

  subscribe(
    onReply: (reply: mixed) => void,
    onError: (e: Error) => void
  ): LobbySubscription {
    this.onReply = onReply
    this.onError = onError
    this.replyCount = 0
    this.task.start()
    return {
      unsubscribe: () => this.task.stop()
    }
  }
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
  const pubkey = Uint8Array.from(keypair.getPublic().encodeCompressed())
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
export function fetchLobbyRequest(
  ai: ApiInput,
  lobbyId: string
): Promise<LobbyRequest> {
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
export async function sendLobbyReply(
  ai: ApiInput,
  lobbyId: string,
  lobbyRequest: LobbyRequest,
  replyData: mixed
): Promise<void> {
  const { io } = ai.props
  if (lobbyRequest.publicKey == null) {
    throw new TypeError('The lobby data does not have a public key')
  }
  const pubkey = base64.parse(lobbyRequest.publicKey)
  const request = {
    data: encryptLobbyReply(io, pubkey, replyData)
  }
  await loginFetch(ai, 'POST', '/v2/lobby/' + lobbyId, request)
}
