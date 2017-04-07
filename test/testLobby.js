/* global describe, it */
import { makeFakeIos } from '../src'
import { IoContext } from '../src/io/io.js'
import {
  encryptLobbyReply,
  decryptLobbyReply,
  makeLobby,
  fetchLobbyRequest,
  sendLobbyReply
} from '../src/login/lobby.js'
import assert from 'assert'
import elliptic from 'elliptic'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')

describe('edge login lobby', function () {
  it('round-trip data', function () {
    const [io] = makeFakeIos(1)
    const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
    const pubkey = keypair.getPublic().encodeCompressed()
    const testReply = { testReply: 'This is a test' }

    assert.deepEqual(
      decryptLobbyReply(keypair, encryptLobbyReply(io, pubkey, testReply)),
      testReply
    )
  })

  it('lobby ping-pong', function () {
    const [io1, io2] = makeFakeIos(2).map(io => new IoContext(io))
    const testRequest = { testRequest: 'This is a test' }
    const testReply = { testReply: 'This is a test' }

    return new Promise((resolve, reject) => {
      makeLobby(io1, testRequest)
        .then(lobby => {
          return fetchLobbyRequest(io2, lobby.lobbyId)
            .then(request => {
              assert.deepEqual(request, testRequest)
              return sendLobbyReply(io2, lobby.lobbyId, request, testReply)
            })
            .then(() => {
              const subscription = lobby.subscribe(
                reply => {
                  assert.deepEqual(reply, testReply)
                  subscription.unsubscribe()
                  return resolve()
                },
                reject
              )
              return subscription
            })
        })
        .catch(reject)
    })
  })
})
