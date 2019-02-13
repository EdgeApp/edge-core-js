// @flow

import { expect } from 'chai'
import elliptic from 'elliptic'
import { describe, it } from 'mocha'

import { getInternalStuff } from '../../../src/core/context/internal-api.js'
import {
  decryptLobbyReply,
  encryptLobbyReply
} from '../../../src/core/login/lobby.js'
import { makeFakeContexts, makeFakeIos } from '../../../src/index.js'

const EC = elliptic.ec
const secp256k1 = new EC('secp256k1')
const contextOptions = {
  apiKey: '',
  appId: ''
}

describe('edge login lobby', function () {
  it('round-trip data', function () {
    const [io] = makeFakeIos(1)
    const keypair = secp256k1.genKeyPair({ entropy: io.random(32) })
    const pubkey = keypair.getPublic().encodeCompressed()
    const testReply = { testReply: 'This is a test' }

    expect(
      decryptLobbyReply(keypair, encryptLobbyReply(io, pubkey, testReply))
    ).deep.equals(testReply)
  })

  it('lobby ping-pong', async function () {
    const [context1, context2] = await makeFakeContexts(
      contextOptions,
      contextOptions
    )
    const i1 = getInternalStuff(context1)
    const i2 = getInternalStuff(context2)
    const testRequest = { testRequest: 'This is a request' }
    const testReply = { testReply: 'This is a reply' }

    return new Promise((resolve, reject) => {
      // Use 10 ms polling to really speed up the test:
      i1.makeLobby(testRequest, 10)
        .then(lobby => {
          lobby.on('error', reject)
          lobby.watch('replies', (replies: Array<Object>) => {
            if (replies.length === 0) return
            lobby.close()
            expect(replies[0]).deep.equals(testReply)
            resolve()
          })

          return i2
            .fetchLobbyRequest(lobby.lobbyId)
            .then(request => {
              expect(request).to.include(testRequest)
              i2.sendLobbyReply(lobby.lobbyId, request, testReply)
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
