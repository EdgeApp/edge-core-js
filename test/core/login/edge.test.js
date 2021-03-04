// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  type EdgeAccount,
  type EdgeFakeWorld,
  type EdgeLobby,
  type EdgePendingEdgeLogin,
  makeFakeEdgeWorld
} from '../../../src/index.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

async function simulateRemoteApproval(
  world: EdgeFakeWorld,
  lobbyId: string
): Promise<void> {
  const context = await world.makeEdgeContext(contextOptions)
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  const lobby: EdgeLobby = await account.fetchLobby(lobbyId)
  const { loginRequest } = lobby
  if (loginRequest == null) throw new Error('No login request')
  expect(loginRequest.appId).equals('test-child')

  await loginRequest.approve()
}

describe('edge login', function () {
  it('works with context callbacks', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      appId: 'test-child',
      cleanDevice: true
    })

    const account: EdgeAccount = await new Promise((resolve, reject) => {
      context.on('login', account => resolve(account))
      context.on('loginError', ({ error }) => reject(error))

      context
        .requestEdgeLogin({ displayName: 'test suite' })
        .then(pending => simulateRemoteApproval(world, pending.id))
        .catch(reject)
    })
    expect(account.appId).equals('test-child')

    return context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('works with local events', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      appId: 'test-child',
      cleanDevice: true
    })

    const pending: EdgePendingEdgeLogin = await context.requestEdgeLogin({
      displayName: 'test suite'
    })
    const out = new Promise((resolve, reject) => {
      pending.watch('state', state => {
        if (state === 'done' && pending.account != null) {
          resolve(pending.account)
        }
        if (state === 'error') reject(pending.error)
      })
    })

    await simulateRemoteApproval(world, pending.id)
    const account = await out
    expect(account.appId).equals('test-child')

    return context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('cancel', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const opts = { displayName: 'test suite' }
    const pendingLogin = await context.requestEdgeLogin(opts)

    // All we can verify here is that cancel is a callable method:
    pendingLogin.cancelRequest()
  })
})
