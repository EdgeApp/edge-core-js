// @flow

import { assert } from 'chai'
import elliptic from 'elliptic'
import { describe, it } from 'mocha'

import { makeFakeContexts, makeFakeIos } from '../../../src/edge-core-index.js'
import {
  decryptLobbyReply,
  encryptLobbyReply,
  fetchLobbyRequest,
  makeLobby,
  sendLobbyReply
} from '../../../src/modules/login/lobby.js'
import type { ApiInput } from '../../../src/modules/root.js'

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
    const [context1, context2] = makeFakeContexts({}, {})
    const ai1: ApiInput = (context1: any).internalUnitTestingHack()
    const ai2: ApiInput = (context2: any).internalUnitTestingHack()
    const testRequest = { testRequest: 'This is a test' }
    const testReply = { testReply: 'This is a test' }

    return new Promise((resolve, reject) => {
      makeLobby(ai1, testRequest)
        .then(lobby => {
          return fetchLobbyRequest(ai2, lobby.lobbyId)
            .then(request => {
              assert.deepEqual(request, testRequest)
              return sendLobbyReply(ai2, lobby.lobbyId, request, testReply)
            })
            .then(() => {
              const subscription = lobby.subscribe(reply => {
                assert.deepEqual(reply, testReply)
                subscription.unsubscribe()
                return resolve()
              }, reject)
              return subscription
            })
        })
        .catch(reject)
    })
  })
})
