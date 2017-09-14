// @flow
import { makeCoreRoot } from '../coreRoot.js'
import type { CoreRoot } from '../coreRoot.js'
import { fakeUser, makeFakeContexts } from '../indexABC.js'
import { base64 } from '../util/encoding.js'
import { fetchLobbyRequest, sendLobbyReply } from './lobby.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

async function sendFakeResponse (coreRoot: CoreRoot, lobbyId, request) {
  const stashTree = await coreRoot.loginStore.load(fakeUser.username)
  stashTree.passwordAuthBox = null
  stashTree.passwordBox = null
  stashTree.pin2Key = null
  stashTree.recovery2Key = null

  const reply = {
    appId: request.loginRequest.appId,
    loginKey: base64.stringify(fakeUser.childLoginKey),
    loginStash: stashTree
  }
  return sendLobbyReply(coreRoot, lobbyId, request, reply)
}

async function simulateRemoteApproval (remote, lobbyId: string) {
  // Populate the remote device's local stash:
  await remote.loginWithPIN(fakeUser.username, fakeUser.pin)

  const coreRoot = makeCoreRoot({ io: remote.io })
  const request = await fetchLobbyRequest(coreRoot, lobbyId)
  assert.equal(request.loginRequest.appId, 'test-child')
  assert.equal(request.loginRequest.displayName, 'test suite')

  return sendFakeResponse(coreRoot, lobbyId, request)
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
