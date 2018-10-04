// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  type EdgeLobby,
  fakeUser,
  makeFakeContexts
} from '../../../src/edge-core-index.js'

async function simulateRemoteApproval (remote, lobbyId: string) {
  const account = await remote.loginWithPIN(fakeUser.username, fakeUser.pin)

  const lobby: EdgeLobby = await account.fetchLobby(lobbyId)
  const { loginRequest } = lobby
  if (!loginRequest) throw new Error('No login request')
  expect(loginRequest.appId).equals('test-child')

  return loginRequest.approve()
}

describe('edge login', function () {
  it('request', async function () {
    const [context, remote] = makeFakeContexts(
      { appId: 'test-child' },
      { localFakeUser: true }
    )

    const account = await new Promise((resolve, reject) => {
      context.on('login', account => resolve(account))
      context.on('loginError', ({ error }) => reject(error))

      return context
        .requestEdgeLogin({ displayName: 'test suite' })
        .then(pending => simulateRemoteApproval(remote, pending.id))
        .catch(reject)
    })
    expect(account.appId).equals('test-child')

    return context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('cancel', async function () {
    const [context] = makeFakeContexts({})

    const opts = { displayName: 'test suite' }
    const pendingLogin = await context.requestEdgeLogin(opts)

    // All we can verify here is that cancel is a callable method:
    pendingLogin.cancelRequest()
  })
})
