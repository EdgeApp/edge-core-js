// @flow

import elliptic from 'elliptic'
import { base64 } from 'rfc4648'
import { type Events, type OnEvents, makeEvents } from 'yavent'

import { asLobbyPayload } from '../../types/server-cleaners.js'
import {
  type EdgeLobbyReply,
  type EdgeLobbyRequest
} from '../../types/server-types.js'
import {
  type EdgeIo,
  type Partial // @ts-delete
} from '../../types/types.js'
import { decryptText, encrypt } from '../../util/crypto/crypto.js'
import { hmacSha256, sha256 } from '../../util/crypto/hashes.js'
import { verifyData } from '../../util/crypto/verify.js'
import { base58, utf8 } from '../../util/encoding.js'
import { makePeriodicTask } from '../../util/periodic-task.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

type Keypair = Object

type LobbyEvents = {
  error: mixed,
  reply: mixed
}

// Use this to subscribe to lobby events:
export type LobbyInstance = {
  +close: () => void,
  +on: OnEvents<LobbyEvents>,

  +replies: mixed[],
  +lobbyId: string
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
  lobbyReply: EdgeLobbyReply
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
): EdgeLobbyReply {
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const sharedKey = deriveSharedKey(keypair, pubkey)
  return {
    publicKey: base64.stringify(keypair.getPublic().encodeCompressed()),
    box: encrypt(io, utf8.parse(JSON.stringify(replyData)), sharedKey)
  }
}

/**
 * Creates a new lobby on the auth server holding the given request.
 * @return A lobby watcher object that will check for incoming replies.
 */
export async function makeLobby(
  ai: ApiInput,
  lobbyRequest: Partial<EdgeLobbyRequest>,
  period: number = 1000
): Promise<LobbyInstance> {
  const { io } = ai.props
  const { timeout = 10 * 60 } = lobbyRequest

  // Create the keys:
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const pubkey = Uint8Array.from(keypair.getPublic().encodeCompressed())
  const lobbyId = base58.stringify(sha256(sha256(pubkey)).slice(0, 10))

  const payload: EdgeLobbyRequest = {
    ...lobbyRequest,
    publicKey: base64.stringify(pubkey),
    timeout
  }
  await loginFetch(ai, 'PUT', `/v2/lobby/${lobbyId}`, { data: payload })

  // Create the task:
  const [on, emit]: Events<LobbyEvents> = makeEvents()
  const replies = []
  const pollLobby = async () => {
    const clean = asLobbyPayload(
      await loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId, {})
    )

    // Process any new replies that have arrived on the server:
    while (replies.length < clean.replies.length) {
      const newReply = clean.replies[replies.length]
      const fixedReply = decryptLobbyReply(keypair, newReply)
      emit('reply', fixedReply)
      replies.push(fixedReply)
    }
  }
  const task = makePeriodicTask(pollLobby, period, {
    onError(error) {
      emit('error', error)
    }
  })
  task.start({ wait: false })

  // Create the return object:
  return { close: task.stop, lobbyId, on, replies }
}

/**
 * Fetches a lobby request from the auth server.
 * @return A promise of the lobby request JSON.
 */
export async function fetchLobbyRequest(
  ai: ApiInput,
  lobbyId: string
): Promise<EdgeLobbyRequest> {
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
  lobbyRequest: EdgeLobbyRequest,
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
