// @flow

import { expect } from 'chai'
import elliptic from 'elliptic'
import { describe, it } from 'mocha'

import { getInternalStuff } from '../../../src/core/context/internal-api.js'
import {
  decryptLobbyReply,
  encryptLobbyReply
} from '../../../src/core/login/lobby.js'
import { makeFakeEdgeWorld, makeFakeIo } from '../../../src/index.js'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')
const contextOptions = { apiKey: '', appId: '' }

describe('edge login lobby', function() {
  it('round-trip data', function() {
    const io = makeFakeIo()
    const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
    const pubkey = keypair.getPublic().encodeCompressed()
    const testReply = { testReply: 'This is a test' }

    const decrypted = decryptLobbyReply(
      keypair,
      encryptLobbyReply(io, Uint8Array.from(pubkey), testReply)
    )
    expect(decrypted).deep.equals(testReply)
  })

  it('lobby ping-pong', async function() {
    const world = await makeFakeEdgeWorld()
    const context1 = await world.makeEdgeContext(contextOptions)
    const context2 = await world.makeEdgeContext(contextOptions)
    const i1 = getInternalStuff(context1)
    const i2 = getInternalStuff(context2)
    const testRequest = { loginRequest: { appId: 'some.test.app' } }
    const testReply = { testReply: 'This is a reply' }

    return new Promise((resolve, reject) => {
      // Use 10 ms polling to really speed up the test:
      i1.makeLobby(testRequest, 10)
        .then(lobby => {
          lobby.on('error', reject)
          lobby.watch('replies', (replies: mixed[]) => {
            if (replies.length === 0) return
            lobby.close()
            expect(replies[0]).deep.equals(testReply)
            resolve()
          })

          return i2
            .fetchLobbyRequest(lobby.lobbyId)
            .then(request => {
              expect(request).to.deep.include(testRequest)
              return i2.sendLobbyReply(lobby.lobbyId, request, testReply)
            })
            .catch(error => {
              lobby.close()
              reject(error)
            })
        })
        .catch(reject)
    })
  })
})
