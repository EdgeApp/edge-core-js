// @flow

import { uncleaner } from 'cleaners'
import { makeMemoryDisklet } from 'disklet'
import { base16, base64 } from 'rfc4648'
import { makeFetchFunction } from 'serverlet'
import { bridgifyObject, close } from 'yaob'

import { fixUsername } from '../../client-side.js'
import {
  type FakeUser,
  asFakeUser,
  asFakeUsers,
  asLoginDump
} from '../../types/fake-types.js'
import { asLoginPayload } from '../../types/server-cleaners.js'
import {
  type EdgeAccount,
  type EdgeContext,
  type EdgeFakeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeIo
} from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { type LogBackend } from '../log/log.js'
import { applyLoginPayload } from '../login/login.js'
import { asLoginStash } from '../login/login-stash.js'
import { type PluginIos } from '../plugins/plugins-actions.js'
import { makeContext } from '../root.js'
import { makeRepoPaths, saveChanges } from '../storage/repo.js'
import { FakeDb } from './fake-db.js'
import { makeFakeServer } from './fake-server.js'

const wasLoginStash = uncleaner(asLoginStash)
const wasLoginDump = uncleaner(asLoginDump)
const wasFakeUser = uncleaner(asFakeUser)

async function saveUser(io: EdgeIo, user: FakeUser): Promise<void> {
  const { lastLogin, loginId, loginKey, repos, server } = user
  const username = fixUsername(user.username)

  // Save the stash:
  const stash = applyLoginPayload(
    {
      appId: '',
      lastLogin,
      loginId,
      pendingVouchers: [],
      username
    },
    loginKey,
    asLoginPayload(wasLoginDump(server))
  )
  const path = `logins/${base58.stringify(loginId)}.json`
  await io.disklet.setText(path, JSON.stringify(wasLoginStash(stash)))

  // Save the repos:
  await Promise.all(
    Object.keys(repos).map(async syncKey => {
      const paths = makeRepoPaths(io, base16.parse(syncKey), new Uint8Array(0))
      await saveChanges(paths.dataDisklet, user.repos[syncKey])
      await paths.baseDisklet.setText(
        'status.json',
        JSON.stringify({ lastSync: 1, lastHash: null })
      )
    })
  )
}

/**
 * Creates a fake Edge server for unit testing.
 */
export function makeFakeWorld(
  ios: PluginIos,
  logBackend: LogBackend,
  users: EdgeFakeUser[]
): EdgeFakeWorld {
  const { io, nativeIo } = ios
  const fakeDb = new FakeDb()
  const fakeServer = makeFakeServer(fakeDb)

  // Populate the fake database:
  const cleanUsers = asFakeUsers(users)
  for (const user of cleanUsers) fakeDb.setupFakeUser(user)

  const contexts: EdgeContext[] = []

  const out = {
    async close() {
      await Promise.all(contexts.map(context => context.close()))
      close(out)
    },

    async makeEdgeContext(opts: EdgeFakeContextOptions): Promise<EdgeContext> {
      const { cleanDevice = false } = opts
      const fakeIo = {
        ...io,
        disklet: makeMemoryDisklet(),
        fetch: makeFetchFunction(fakeServer)
      }

      // Populate the fake disk:
      if (!cleanDevice) {
        await Promise.all(cleanUsers.map(async user => saveUser(fakeIo, user)))
      }

      fakeIo.disklet.setText(
        'rateHintCache.json',
        JSON.stringify([{ fromCurrency: 'FAKE', toCurrency: 'TOKEN' }])
      )

      const out = await makeContext({ io: fakeIo, nativeIo }, logBackend, {
        ...opts
      })
      contexts.push(out)
      return out
    },

    async goOffline(offline: boolean = true): Promise<void> {
      fakeServer.offline = offline
    },

    async dumpFakeUser(account: EdgeAccount): Promise<EdgeFakeUser> {
      if (account.appId !== '') {
        throw new Error('Only root logins are dumpable.')
      }
      const loginId = base58.parse(account.rootLoginId)

      // Find the data on the server:
      const login = fakeDb.getLoginById(loginId)
      if (login == null) throw new Error(`Cannot find user ${account.username}`)

      // Figure out which repos to use:
      const syncKeys = account.allKeys
        .filter(info => info.keys != null && info.keys.syncKey != null)
        .map(info =>
          base16.stringify(base64.parse(info.keys.syncKey)).toLowerCase()
        )
      const repos = {}
      for (const syncKey of syncKeys) repos[syncKey] = fakeDb.repos[syncKey]

      return wasFakeUser({
        lastLogin: account.lastLogin,
        loginId,
        loginKey: base58.parse(account.loginKey),
        repos,
        server: fakeDb.dumpLogin(login),
        username: account.username
      })
    }
  }
  bridgifyObject(out)

  return out
}
