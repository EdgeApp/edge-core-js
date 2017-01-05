import {FakeServer} from './fakeServer.js'
import {FakeStorage} from './fakeStorage.js'
import * as packages from './packages.js'

import * as abc from '../../src/abc.js'
import {Account} from '../../src/account.js'
import {Login} from '../../src/login/login.js'

export function makeSession (opts) {
  const session = {}

  // Expand needs flags:
  opts.needsLogin |= opts.needsAccount
  opts.needsContext |= opts.needsLogin

  if (opts.needsContext) {
    session.storage = new FakeStorage()
    session.server = new FakeServer()
    session.context = abc.makeContext({
      console: null,
      localStorage: session.storage,
      fetch: session.server.bindFetch(),
      accountType: opts.accountType
    })
  }

  if (opts.needsLogin) {
    session.storage.populate()
    const userId = new Buffer(packages.users['js test 0'], 'base64')
    session.login = Login.offline(session.context.io, 'js test 0', userId, packages.dataKey)
  }

  if (opts.needsAccount) {
    session.account = new Account(session.context, session.login)
  }

  return session
}
