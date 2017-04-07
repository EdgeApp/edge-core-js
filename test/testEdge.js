/* global describe, it */
import { makeContext, makeFakeIos } from '../src'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import { fetchLobbyRequest, sendLobbyReply } from '../src/login/lobby.js'
import { base64 } from '../src/util/encoding.js'
import assert from 'assert'

describe('edge login', function () {
  it('request', function () {
    const ios = makeFakeIos(2)
    const context = makeContext({ io: ios[0], appId: 'test-child' })
    const remote = makeContext({ io: ios[1] })
    makeFakeAccount(remote, fakeUser)

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

            const stash = remote.io.loginStore.loadSync(fakeUser.username)
            stash.passwordAuthBox = null
            stash.passwordBox = null
            stash.pin2Key = null
            stash.recovery2Key = null

            const reply = {
              appId: request.loginRequest.appId,
              loginKey: base64.stringify(fakeUser.children[0].loginKey),
              loginStash: stash
            }
            return sendLobbyReply(remote.io, lobbyId, request, reply)
          })
        })
        .catch(reject)
    }).then(() => context.loginWithPIN(fakeUser.username, fakeUser.pin))
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
