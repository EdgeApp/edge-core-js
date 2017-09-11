import { makeContext, makeFakeIos } from '../indexABC.js'
import { fakeUser, makeFakeAccount } from '../test/fakeUser.js'
import { base64 } from '../util/encoding.js'
import { fetchLobbyRequest, sendLobbyReply } from './lobby.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

function sendFakeResponse (context, lobbyId, request) {
  return context.io.loginStore.load(fakeUser.username).then(stashTree => {
    stashTree.passwordAuthBox = null
    stashTree.passwordBox = null
    stashTree.pin2Key = null
    stashTree.recovery2Key = null

    const reply = {
      appId: request.loginRequest.appId,
      loginKey: base64.stringify(fakeUser.children[0].loginKey),
      loginStash: stashTree
    }
    return sendLobbyReply(context.io, lobbyId, request, reply)
  })
}

describe('edge login', function () {
  it('request', function () {
    const ios = makeFakeIos(2)
    const context = makeContext({ io: ios[0], appId: 'test-child' })
    const remote = makeContext({ io: ios[1] })

    return makeFakeAccount(remote, fakeUser).then(() => {
      return new Promise((resolve, reject) => {
        const opts = {
          onLogin: (err, account) => {
            if (err) return reject(err)
            return resolve()
          },
          displayName: 'test suite'
        }
        return context
          .requestEdgeLogin(opts)
          .then(pending => {
            const lobbyId = pending.id

            return fetchLobbyRequest(remote.io, lobbyId).then(request => {
              assert.equal(request.loginRequest.appId, context.appId)
              assert.equal(request.loginRequest.displayName, 'test suite')

              return sendFakeResponse(remote, lobbyId, request)
            })
          })
          .catch(reject)
      }).then(() => context.loginWithPIN(fakeUser.username, fakeUser.pin))
    })
  })

  it('cancel', function (done) {
    const context = makeContext({ io: makeFakeIos(1)[0] })

    const opts = {
      onLogin: function () {},
      displayName: 'test suite'
    }

    context.requestEdgeLogin(opts, function (err, pendingLogin) {
      if (err) return done(err)
      // All we can verify here is that cancel is a callable method:
      pendingLogin.cancelRequest()
      done()
    })
  })
})
