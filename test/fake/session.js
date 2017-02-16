import {FakeServer} from './fakeServer.js'
import {FakeStorage} from './fakeStorage.js'
import * as packages from './packages.js'

import * as abc from '../../src/abc.js'
import {Account} from '../../src/account.js'
import {Login} from '../../src/login/login.js'
import {base64} from '../../src/util/encoding.js'

const fakeConsole = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

/**
 * Generates deterministic "random" data for unit-testing.
 */
function fakeRandom (bytes) {
  const out = []
  let x = 0
  for (let i = 0; i < bytes; ++i) {
    // Simplest numbers that give a full-period generator with
    // a good mix of high & low values in the first few bytes:
    x = (5 * x + 3) & 0xff
    out[i] = x
  }
  return out
}

export function makeFakeIo () {
  const server = new FakeServer()
  const storage = new FakeStorage()

  return {
    console: fakeConsole,
    fetch: server.fetch,
    localStorage: storage,
    random: fakeRandom
  }
}

export function makeSession (opts) {
  const session = {}

  // Expand needs flags:
  opts.needsLogin |= opts.needsAccount
  opts.needsContext |= opts.needsLogin

  if (opts.needsContext) {
    session.storage = new FakeStorage()
    session.server = new FakeServer()
    session.context = abc.makeContext({
      console: fakeConsole,
      localStorage: session.storage,
      fetch: session.server.fetch,
      random: fakeRandom,
      accountType: opts.accountType
    })
  }

  if (opts.needsLogin) {
    session.storage.populate()
    const userId = base64.parse(packages.users['js test 0'])
    session.login = Login.offline(session.context.io, 'js test 0', userId, packages.dataKey)
  }

  if (opts.needsAccount) {
    session.account = new Account(session.context, session.login)
  }

  return session
}
