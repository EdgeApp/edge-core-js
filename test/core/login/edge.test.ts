import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  EdgeAccount,
  EdgeFakeWorld,
  EdgeLobby,
  EdgePendingEdgeLogin,
  makeFakeEdgeWorld
} from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'

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
  it('works with local events', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      appId: 'test-child',
      cleanDevice: true
    })

    const pending: EdgePendingEdgeLogin = await context.requestEdgeLogin()
    const out: Promise<EdgeAccount> = new Promise((resolve, reject) => {
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

    const pendingLogin = await context.requestEdgeLogin()

    // All we can verify here is that cancel is a callable method:
    pendingLogin.cancelRequest().catch(() => {})
  })
})
