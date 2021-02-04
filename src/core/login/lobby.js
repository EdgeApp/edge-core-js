// @flow

import elliptic from 'elliptic'
import { base64 } from 'rfc4648'

import { asLobbyPayload } from '../../types/server-cleaners.js'
import { type LobbyReply, type LobbyRequest } from '../../types/server-types.js'
import { type EdgeIo } from '../../types/types.js'
import { decryptText, encrypt } from '../../util/crypto/crypto.js'
import { hmacSha256, sha256 } from '../../util/crypto/hashes.js'
import { verifyData } from '../../util/crypto/verify.js'
import { base58, utf8 } from '../../util/encoding.js'
import {
  type PeriodicTask,
  makePeriodicTask
} from '../../util/periodic-task.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'

/**
 * A `LobbyRequest` without its key.
 */
export type PartialLobbyRequest = $Shape<LobbyRequest>

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

type Keypair = Object

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
      const clean = asLobbyPayload(
        await loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId, {})
      )

      // Process any new replies that have arrived on the server:
      while (this.replyCount < clean.replies.length) {
        const lobbyReply = clean.replies[this.replyCount]
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
export async function makeLobby(
  ai: ApiInput,
  lobbyRequest: PartialLobbyRequest,
  period: number = 1000
): Promise<LobbyInstance> {
  const { io } = ai.props
  const { loginRequest, timeout = 600 } = lobbyRequest

  // Create the keys:
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const pubkey = Uint8Array.from(keypair.getPublic().encodeCompressed())
  const lobbyId = base58.stringify(sha256(sha256(pubkey)).slice(0, 10))

  const payload: LobbyRequest = {
    loginRequest,
    publicKey: base64.stringify(pubkey),
    timeout
  }
  await loginFetch(ai, 'PUT', '/v2/lobby/' + lobbyId, { data: payload })
  return new ObservableLobby(ai, lobbyId, keypair, period)
}

/**
 * Fetches a lobby request from the auth server.
 * @return A promise of the lobby request JSON.
 */
export async function fetchLobbyRequest(
  ai: ApiInput,
  lobbyId: string
): Promise<LobbyRequest> {
  const clean = asLobbyPayload(
    await loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId, {})
  )

  // Verify the public key:
  const pubkey = base64.parse(clean.request.publicKey)
  const checksum = sha256(sha256(pubkey))
  const idBytes = base58.parse(lobbyId)
  if (!verifyData(idBytes, checksum.subarray(0, idBytes.length))) {
    throw new Error('Lobby ECDH integrity error')
  }

  return clean.request
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
  const payload = encryptLobbyReply(io, pubkey, replyData)
  await loginFetch(ai, 'POST', '/v2/lobby/' + lobbyId, { data: payload })
}
