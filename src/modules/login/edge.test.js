// @flow
import { assert } from 'chai'
import { describe, it } from 'mocha'
import { fakeUser, makeFakeContexts } from '../../indexABC.js'
import { base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { fetchLobbyRequest, sendLobbyReply } from './lobby.js'

async function sendFakeResponse (ai: ApiInput, lobbyId, request) {
  const stashTree = await ai.props.loginStore.load(fakeUser.username)
  stashTree.passwordAuthBox = null
  stashTree.passwordBox = null
  stashTree.pin2Key = null
  stashTree.recovery2Key = null

  const reply = {
    appId: request.loginRequest.appId,
    loginKey: base64.stringify(fakeUser.childLoginKey),
    loginStash: stashTree
  }
  return sendLobbyReply(ai, lobbyId, request, reply)
}

async function simulateRemoteApproval (remote, lobbyId: string) {
  // Populate the remote device's local stash:
  await remote.loginWithPIN(fakeUser.username, fakeUser.pin)

  const ai: ApiInput = (remote: any).internalUnitTestingHack()
  const request = await fetchLobbyRequest(ai, lobbyId)
  assert.equal(request.loginRequest.appId, 'test-child')
  assert.equal(request.loginRequest.displayName, 'test suite')

  return sendFakeResponse(ai, lobbyId, request)
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
