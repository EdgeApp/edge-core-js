// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import type { EdgeLobby } from '../../../src/edge-core-index.js'
import { fakeUser, makeFakeContexts } from '../../../src/edge-core-index.js'

async function simulateRemoteApproval (remote, lobbyId: string) {
  const account = await remote.loginWithPIN(fakeUser.username, fakeUser.pin)

  const lobby: EdgeLobby = await account.fetchLobby(lobbyId)
  const { loginRequest } = lobby
  if (!loginRequest) throw new Error('No login request')
  expect(loginRequest.appId).to.equal('test-child')

  return loginRequest.approve()
}

describe('edge login', function () {
  it('request', async function () {
    const [context, remote] = makeFakeContexts(
      { appId: 'test-child' },
      { localFakeUser: true }
    )

    await new Promise((resolve, reject) => {
      const opts = {
        onLogin: (err, account) => {
          if (err) return reject(err)
          return resolve()
        },
        displayName: 'test suite'
      }
      return context
        .requestEdgeLogin(opts)
        .then(pending => simulateRemoteApproval(remote, pending.id))
        .catch(reject)
    })

    return context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })

  it('cancel', async function () {
    const [context] = makeFakeContexts({})

    const opts = {
      onLogin: function () {},
      displayName: 'test suite'
    }
    const pendingLogin = await context.requestEdgeLogin(opts)

    // All we can verify here is that cancel is a callable method:
    pendingLogin.cancelRequest()
  })
})
