import { uncleaner } from 'cleaners'
import { makeMemoryDisklet } from 'disklet'
import { base16, base64 } from 'rfc4648'
import { makeFetchFunction } from 'serverlet'
import { bridgifyObject, close } from 'yaob'

import { fixUsername } from '../../client-side'
import {
  asFakeUser,
  asFakeUsers,
  asLoginDump,
  FakeUser
} from '../../types/fake-types'
import { asLoginPayload } from '../../types/server-cleaners'
import {
  EdgeAccount,
  EdgeContext,
  EdgeFakeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeFetchFunction,
  EdgeIo
} from '../../types/types'
import { base58 } from '../../util/encoding'
import { validateServer } from '../../util/validateServer'
import { LogBackend } from '../log/log'
import { applyLoginPayload } from '../login/login'
import { asLoginStash } from '../login/login-stash'
import { PluginIos } from '../plugins/plugins-actions'
import { makeContext } from '../root'
import { makeRepoPaths, saveChanges } from '../storage/repo'
import { FakeDb } from './fake-db'
import { makeFakeServer } from './fake-server'

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
  await io.disklet
    .setText(path, JSON.stringify(wasLoginStash(stash)))
    .catch(() => {})

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
      const { allowNetworkAccess = false, cleanDevice = false } = opts

      const fakeFetch = makeFetchFunction(fakeServer)
      const fetch: EdgeFetchFunction = !allowNetworkAccess
        ? fakeFetch
        : (uri, opts) => {
            try {
              validateServer(uri) // Throws for non-Edge servers.
            } catch (e) {
              return io.fetch(uri, opts)
            }
            return fakeFetch(uri, opts)
          }

      const fakeIo = {
        ...io,
        disklet: makeMemoryDisklet(),
        fetch
      }

      // Populate the fake disk:
      if (!cleanDevice) {
        await Promise.all(
          cleanUsers.map(async user => await saveUser(fakeIo, user))
        )
      }

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
        .filter(info => info.keys?.syncKey != null)
        .map(info =>
          base16.stringify(base64.parse(info.keys.syncKey)).toLowerCase()
        )
      const repos: EdgeFakeUser['repos'] = {}
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
