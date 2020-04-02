// @flow

import { makeMemoryDisklet } from 'disklet'
import { base16, base64 } from 'rfc4648'
import { bridgifyObject, close } from 'yaob'

import { fixUsername } from '../../client-side.js'
import {
  type EdgeAccount,
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeIo,
  type EdgeNativeIo
} from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { makeFetch } from '../../util/http/http-to-fetch.js'
import { getInternalStuff } from '../context/internal-api.js'
import { applyLoginReply } from '../login/login.js'
import { makeContext } from '../root.js'
import { makeRepoPaths, saveChanges } from '../storage/repo.js'
import { FakeDb } from './fake-db.js'
import { fakeConsole } from './fake-io.js'
import { makeFakeServer } from './fake-server.js'

async function saveUser(io: EdgeIo, user: EdgeFakeUser) {
  const { loginId, loginKey, username } = user
  // JsonObject doesn't match LoginReply:
  const server: any = user.server

  // Save the stash:
  const stash = applyLoginReply(
    { appId: '', otpKey: server.otpKey, username: fixUsername(username) },
    base64.parse(loginKey),
    server
  )
  const path = `logins/${base58.stringify(base64.parse(loginId))}.json`
  await io.disklet.setText(path, JSON.stringify(stash))

  // Save the repos:
  await Promise.all(
    Object.keys(user.repos).map(async syncKey => {
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
  io: EdgeIo,
  nativeIo: EdgeNativeIo,
  users: EdgeFakeUser[]
): EdgeFakeWorld {
  const fakeDb = new FakeDb()
  const fakeServer = makeFakeServer(fakeDb)
  for (const user of users) fakeDb.setupFakeUser(user)

  const contexts: EdgeContext[] = []

  const out = {
    async close() {
      await Promise.all(contexts.map(context => context.close()))
      close(out)
    },

    async makeEdgeContext(
      opts: EdgeContextOptions & { cleanDevice?: boolean }
    ): Promise<EdgeContext> {
      const fakeIo = {
        ...io,
        console: fakeConsole,
        disklet: makeMemoryDisklet(),
        fetch: makeFetch(fakeServer)
      }

      // Populate the stashes:
      if (!opts.cleanDevice) {
        await Promise.all(users.map(async user => saveUser(fakeIo, user)))
      }

      const out = await makeContext(fakeIo, nativeIo, opts)
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

      // Hash the username:
      const context = await out.makeEdgeContext({ appId: '', apiKey: '' })
      const internal = getInternalStuff(context)
      const loginId = base64.stringify(
        await internal.hashUsername(account.username)
      )

      // Find the data on the server:
      const login = fakeDb.getLoginById(loginId)
      if (!login) throw new Error(`Cannot find user ${account.username}`)

      // Figure out which repos to use:
      const syncKeys = account.allKeys
        .filter(info => info.keys != null && info.keys.syncKey != null)
        .map(info =>
          base16.stringify(base64.parse(info.keys.syncKey)).toLowerCase()
        )
      const repos = {}
      for (const syncKey of syncKeys) repos[syncKey] = fakeDb.repos[syncKey]

      return {
        loginId,
        loginKey: base64.stringify(base58.parse(account.loginKey)),
        repos,
        server: fakeDb.dumpLogin(login),
        username: account.username
      }
    }
  }
  bridgifyObject(out)

  return out
}
