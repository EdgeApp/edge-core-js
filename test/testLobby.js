/* global describe, it */
import { makeFakeContexts } from '../src'
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
    const [context] = makeFakeContexts(1)
    const keypair = secp256k1.genKeyPair({ entropy: context.io.random(32) })
    const pubkey = keypair.getPublic().encodeCompressed()
    const testReply = { testReply: 'This is a test' }

    assert.deepEqual(
      decryptLobbyReply(
        keypair,
        encryptLobbyReply(context.io, pubkey, testReply)
      ),
      testReply
    )
  })

  it('lobby ping-pong', function () {
    const [context1, context2] = makeFakeContexts(2)
    const testRequest = { testRequest: 'This is a test' }
    const testReply = { testReply: 'This is a test' }

    return new Promise((resolve, reject) => {
      makeLobby(context1.io, testRequest)
        .then(lobby => {
          return fetchLobbyRequest(context2.io, lobby.lobbyId)
            .then(request => {
              assert.deepEqual(request, testRequest)
              return sendLobbyReply(
                context2.io,
                lobby.lobbyId,
                request,
                testReply
              )
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
