// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { type EdgeLobby, makeFakeEdgeWorld } from '../../../src/index.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

async function simulateRemoteApproval (world, lobbyId: string) {
  const context = await world.makeEdgeContext(contextOptions)
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  const lobby: EdgeLobby = await account.fetchLobby(lobbyId)
  const { loginRequest } = lobby
  if (!loginRequest) throw new Error('No login request')
  expect(loginRequest.appId).equals('test-child')

  return loginRequest.approve()
}

describe('edge login', function () {
  it('request', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext({
      ...contextOptions,
      appId: 'test-child',
      cleanDevice: true
    })

    const account = await new Promise((resolve, reject) => {
      context.on('login', account => resolve(account))
      context.on('loginError', ({ error }) => reject(error))

      return context
        .requestEdgeLogin({ displayName: 'test suite' })
        .then(pending => simulateRemoteApproval(world, pending.id))
        .catch(reject)
    })
    expect(account.appId).equals('test-child')

    return context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('cancel', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext(contextOptions)

    const opts = { displayName: 'test suite' }
    const pendingLogin = await context.requestEdgeLogin(opts)

    // All we can verify here is that cancel is a callable method:
    pendingLogin.cancelRequest()
  })
})
