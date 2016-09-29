import {FakeServer} from './fakeServer.js'
import {FakeStorage} from './fakeStorage.js'
import * as packages from './packages.js'

import * as abc from '../../src/abc.js'
import {Account} from '../../src/account.js'
import {Login} from '../../src/login/login.js'

export function makeSession (opts) {
  var session = {}

  // Expand needs flags:
  opts.needsLogin |= opts.needsAccount
  opts.needsContext |= opts.needsLogin

  if (opts.needsContext) {
    session.storage = new FakeStorage()
    session.server = new FakeServer()
    session.context = new abc.Context({
      localStorage: session.storage,
      authRequest: session.server.bindRequest(),
      accountType: opts.accountType
    })
  }

  if (opts.needsLogin) {
    session.storage.populate()
    session.login = Login.offline(session.storage, 'js test 0', packages.dataKey)
  }

  if (opts.needsAccount) {
    session.account = new Account(session.context, session.login)
  }

  return session
}
