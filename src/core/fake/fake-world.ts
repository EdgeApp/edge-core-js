import { makeMemoryDisklet } from 'disklet'
import { base16, base64 } from 'rfc4648'
import { makeFetchFunction } from 'serverlet'
import { bridgifyObject, close } from 'yaob'

import { fixUsername } from '../../client-side'
import {
  asEdgeLoginDump,
  asEdgeRepoDump,
  EdgeRepoDump,
  wasEdgeLoginDump,
  wasEdgeRepoDump
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
import { wasLoginStash } from '../login/login-stash'
import { PluginIos } from '../plugins/plugins-actions'
import { makeContext } from '../root'
import { makeRepoPaths, saveChanges } from '../storage/repo'
import { FakeDb } from './fake-db'
import { makeFakeServer } from './fake-server'

async function saveLogin(io: EdgeIo, user: EdgeFakeUser): Promise<void> {
  const { lastLogin, server } = user
  const loginId = base64.parse(user.loginId)
  const loginKey = base64.parse(user.loginKey)
  const username =
    user.username == null ? undefined : fixUsername(user.username)

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
    // The correct cleaner is `asEdgeLoginDump`,
    // but the format is close enough that the other cleaner kinda fits:
    asLoginPayload(server)
  )
  const path = `logins/${base58.stringify(loginId)}.json`
  await io.disklet
    .setText(path, JSON.stringify(wasLoginStash(stash)))
    .catch(() => {})
}

async function saveRepo(
  io: EdgeIo,
  syncKey: Uint8Array,
  repo: EdgeRepoDump
): Promise<void> {
  const paths = makeRepoPaths(io, {
    dataKey: new Uint8Array(0),
    syncKey
  })
  await saveChanges(paths.dataDisklet, repo)
  await paths.baseDisklet.setText(
    'status.json',
    JSON.stringify({ lastSync: 1, lastHash: null })
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
  for (const user of users) {
    fakeDb.setupLogin(asEdgeLoginDump(user.server))
    for (const syncKey of Object.keys(user.repos)) {
      fakeDb.setupRepo(syncKey, asEdgeRepoDump(user.repos[syncKey]))
    }
  }

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
            } catch (error: unknown) {
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
        for (const user of users) {
          await saveLogin(fakeIo, user)
          for (const syncKey of Object.keys(user.repos)) {
            await saveRepo(
              fakeIo,
              base16.parse(syncKey),
              asEdgeRepoDump(user.repos[syncKey])
            )
          }
        }
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
      const loginKey = base58.parse(await account.getLoginKey())

      // Find the data on the server:
      const login = fakeDb.getLoginById(loginId)
      if (login == null) throw new Error(`Cannot find user ${account.username}`)

      // Figure out which repos to use:
      const syncKeys: string[] = []
      for (const info of account.allKeys) {
        const keys = await account.getRawPrivateKey(info.id)
        if (keys.syncKey == null) continue
        syncKeys.push(
          base16.stringify(base64.parse(keys.syncKey)).toLowerCase()
        )
      }
      const repos: EdgeFakeUser['repos'] = {}
      for (const syncKey of syncKeys) {
        repos[syncKey] = wasEdgeRepoDump(fakeDb.repos[syncKey])
      }

      return {
        lastLogin: account.lastLogin,
        loginId: base64.stringify(loginId),
        loginKey: base64.stringify(loginKey),
        repos,
        server: wasEdgeLoginDump(fakeDb.dumpLogin(login)),
        username: account.username
      }
    }
  }
  bridgifyObject(out)

  return out
}
