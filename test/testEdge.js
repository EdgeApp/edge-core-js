/* global describe, it */
import { makeFakeContexts } from '../src'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import { fetchLobbyRequest, sendLobbyReply } from '../src/login/lobby.js'
import { base64 } from '../src/util/encoding.js'
import assert from 'assert'

describe('edge login', function () {
  it('request', function () {
    const [context, remote] = makeFakeContexts(2)
    context.appId = 'test-child'
    makeFakeAccount(remote, fakeUser)

    return new Promise((resolve, reject) => {
      const opts = {
        onLogin: (err, account) => {
          if (err) return reject(err)
          return resolve()
        },
        displayName: 'test suite'
      }
      return context.requestEdgeLogin(opts).then(pending => {
        const lobbyId = pending.id

        return fetchLobbyRequest(remote.io, lobbyId).then(request => {
          assert.equal(request.loginRequest.appId, context.appId)
          assert.equal(request.loginRequest.displayName, 'test suite')

          const reply = {
            appId: request.loginRequest.appId,
            loginKey: base64.stringify(fakeUser.children[0].loginKey),
            loginStash: remote.io.loginStore.loadSync(fakeUser.username)
          }
          return sendLobbyReply(remote.io, lobbyId, request, reply)
        })
      }).catch(reject)
    })
  })

  it('cancel', function (done) {
    const [context] = makeFakeContexts(1)

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
