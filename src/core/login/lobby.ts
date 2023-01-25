import { uncleaner } from 'cleaners'
import elliptic from 'elliptic'
import { Events, makeEvents, OnEvents } from 'yavent'

import {
  asEdgeLobbyReply,
  asEdgeLobbyRequest,
  asLobbyPayload
} from '../../types/server-cleaners'
import { EdgeLobbyReply, EdgeLobbyRequest } from '../../types/server-types'
import { EdgeIo } from '../../types/types'
import { decryptText, encrypt } from '../../util/crypto/crypto'
import { hmacSha256, sha256 } from '../../util/crypto/hashes'
import { verifyData } from '../../util/crypto/verify'
import { base58, utf8 } from '../../util/encoding'
import { makePeriodicTask } from '../../util/periodic-task'
import { ApiInput } from '../root-pixie'
import { loginFetch } from './login-fetch'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

const wasEdgeLobbyReply = uncleaner(asEdgeLobbyReply)
const wasEdgeLobbyRequest = uncleaner(asEdgeLobbyRequest)

type KeyPair = elliptic.ec.KeyPair

interface LobbyEvents {
  error: unknown
  reply: unknown
}

// Use this to subscribe to lobby events:
export interface LobbyInstance {
  readonly close: () => void
  readonly on: OnEvents<LobbyEvents>

  readonly replies: unknown[]
  readonly lobbyId: string
}

/**
 * Derives a shared secret from the given secret key and public key.
 */
function deriveSharedKey(keypair: KeyPair, pubkey: Uint8Array): Uint8Array {
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
  keypair: KeyPair,
  lobbyReply: EdgeLobbyReply
): unknown {
  const { publicKey } = lobbyReply
  const sharedKey = deriveSharedKey(keypair, publicKey)
  return JSON.parse(decryptText(lobbyReply.box, sharedKey))
}

/**
 * Encrypts a lobby reply JSON replyData, and returns a reply
 * suitable for sending to the server.
 */
export function encryptLobbyReply(
  io: EdgeIo,
  publicKey: Uint8Array,
  replyData: unknown
): EdgeLobbyReply {
  const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
  const sharedKey = deriveSharedKey(keypair, publicKey)
  return {
    publicKey: Uint8Array.from(keypair.getPublic().encodeCompressed()),
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
  const publicKey = Uint8Array.from(keypair.getPublic().encodeCompressed())
  const lobbyId = base58.stringify(sha256(sha256(publicKey)).slice(0, 10))

  const request = {
    data: wasEdgeLobbyRequest({ ...lobbyRequest, publicKey, timeout })
  }
  await loginFetch(ai, 'PUT', `/v2/lobby/${lobbyId}`, request)

  // Create the task:
  const [on, emit]: Events<LobbyEvents> = makeEvents()
  const replies: unknown[] = []
  const pollLobby = async (): Promise<void> => {
    const clean = asLobbyPayload(
      await loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId)
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
    await loginFetch(ai, 'GET', '/v2/lobby/' + lobbyId)
  )

  // Verify the public key:
  const { publicKey } = clean.request
  const checksum = sha256(sha256(publicKey))
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
  replyData: unknown
): Promise<void> {
  const { io } = ai.props
  const { publicKey } = lobbyRequest

  const request = {
    data: wasEdgeLobbyReply(encryptLobbyReply(io, publicKey, replyData))
  }
  await loginFetch(ai, 'POST', '/v2/lobby/' + lobbyId, request)
}
