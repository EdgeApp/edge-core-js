import { expect } from 'chai'
import { makeSyncClient } from 'edge-sync-client'
import { afterEach, describe, it } from 'mocha'
import { base16, base64 } from 'rfc4648'
import { makeFetchFunction } from 'serverlet'

import { RootAction } from '../../../src/core/actions'
import { FakeDb } from '../../../src/core/fake/fake-db'
import { makeFakeServer } from '../../../src/core/fake/fake-server'
import {
  FakeSyncWsServer,
  makeFakeSyncWsServer
} from '../../../src/core/fake/fake-sync-ws-server'
import { makeLog } from '../../../src/core/log/log'
import { ApiInput } from '../../../src/core/root-pixie'
import { makeLocalDisklet, makeRepoPaths } from '../../../src/core/storage/repo'
import {
  listWatchedRepos,
  newestCheckpoint,
  repoChangeManager
} from '../../../src/core/storage/repo-change-manager'
import {
  isRepoListening,
  makeRepoPollingTask,
  storageSyncConfig
} from '../../../src/core/storage/storage-actions'
import {
  storageWallets,
  StorageWalletsState
} from '../../../src/core/storage/storage-reducer'
import {
  syncServerConfig,
  SyncSocketFactory
} from '../../../src/core/storage/sync-server-connection'
import { makeFakeIo } from '../../../src/index'
import { asEdgeBox } from '../../../src/types/server-cleaners'
import { snooze } from '../../../src/util/snooze'
import { waitUntil } from '../../wait-until'

const savedServerConfig = { ...syncServerConfig }
const savedStorageConfig = { ...storageSyncConfig }

const box = asEdgeBox({
  encryptionType: 0,
  iv_hex: '82454458a5eaa6bc7dc4b4081b9f36d1',
  data_base64:
    'lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=='
})

interface MiniState {
  accountIds: string[]
  accounts: {
    [id: string]: { accountWalletInfos: Array<{ id: string }> }
  }
  currency: { currencyWalletIds: string[] }
  paused: boolean
  storageWallets: StorageWalletsState
  syncWebSocketServers: string[]
}

interface RepoSpec {
  /** Present on the server, with this many files. */
  files?: number

  /** The client's `lastHash`, or 'current' for the server's value. */
  lastHash?: string | 'current'

  syncOwed?: boolean
}

interface ManagerHarness {
  db: FakeDb
  getCounts: Map<string, number>
  hexes: string[]
  ids: string[]
  server: FakeSyncWsServer
  readonly state: MiniState
  status: (i: number) => string
  gets: (i: number) => number
  setPaused: (paused: boolean) => void
  setWatched: (watched: string[]) => void
  write: (i: number) => void
  destroy: () => void
}

/**
 * Drives the manager against a small Redux-like store,
 * so a test can hold hundreds of repos without real wallets.
 */
function makeManagerHarness(
  specs: RepoSpec[],
  opts: {
    makeSocket?: (server: FakeSyncWsServer) => SyncSocketFactory
    urls?: string[]
  } = {}
): ManagerHarness {
  const db = new FakeDb()
  const server = makeFakeSyncWsServer(db)
  const fakeFetch = makeFetchFunction(makeFakeServer(db))
  const getCounts = new Map<string, number>()
  const io = {
    ...makeFakeIo(),
    fetch: async (uri: string, init?: any) => {
      const match = /\/api\/v2\/store\/([0-9a-f]+)/.exec(uri)
      if (match != null && (init?.method ?? 'GET') === 'GET') {
        getCounts.set(match[1], (getCounts.get(match[1]) ?? 0) + 1)
      }
      return await fakeFetch(uri, init)
    }
  }
  const log = makeLog({ onLog() {} }, 'test')
  const syncClient = makeSyncClient({
    log,
    fetch: io.fetch as any,
    edgeServers: {
      infoServers: ['https://info1.edge.app'],
      syncServers: ['https://sync-us1.edge.app']
    }
  })

  const ids: string[] = []
  const hexes: string[] = []
  let state: MiniState = {
    accountIds: [],
    accounts: {},
    currency: { currencyWalletIds: [] },
    paused: false,
    storageWallets: {},
    syncWebSocketServers: opts.urls ?? ['wss://sync-us1.edge.app/api/v2/ws']
  }

  let updateQueued = false
  function dispatch(action: RootAction): RootAction {
    state = {
      ...state,
      storageWallets: storageWallets(state.storageWallets, action)
    }
    if (!updateQueued) {
      updateQueued = true
      setTimeout(() => {
        updateQueued = false
        if (!destroyed) manager.update()
      }, 0)
    }
    return action
  }

  const input: ApiInput = {
    get props() {
      return {
        dispatch,
        io,
        log,
        makeSyncSocket: (opts.makeSocket ?? (s => s.makeSocket))(server),
        state,
        syncClient
      }
    }
  } as any

  specs.forEach((spec, i) => {
    const syncKey = new Uint8Array(20)
    syncKey[0] = i & 0xff
    syncKey[1] = i >> 8
    syncKey[19] = 7
    const hex = base16.stringify(syncKey).toLowerCase()
    const id = base64.stringify(syncKey)
    ids.push(id)
    hexes.push(hex)
    if (spec.files != null) {
      const repo: { [path: string]: typeof box } = {}
      for (let j = 0; j < spec.files; ++j) repo[`f${j}.json`] = box
      db.setupRepo(hex, repo)
    }
    const lastHash =
      spec.lastHash === 'current' ? db.getRepoCheckpoint(hex) : spec.lastHash
    dispatch({
      type: 'STORAGE_WALLET_ADDED',
      payload: {
        id,
        initialState: {
          lastChanges: [],
          localDisklet: makeLocalDisklet(io, id),
          paths: makeRepoPaths(io, { dataKey: new Uint8Array(32), syncKey }),
          status: { lastSync: 1, lastHash },
          subscription: {
            status: 'unsubscribed',
            syncOwed: spec.syncOwed ?? false
          }
        }
      }
    })
  })
  state = { ...state, currency: { currencyWalletIds: ids } }

  let destroyed = false
  const manager = repoChangeManager(input)
  manager.update()

  return {
    db,
    getCounts,
    hexes,
    ids,
    server,
    get state() {
      return state
    },
    status(i: number) {
      return state.storageWallets[ids[i]].subscription.status
    },
    gets(i: number) {
      return getCounts.get(hexes[i]) ?? 0
    },
    setPaused(paused: boolean) {
      state = { ...state, paused }
      manager.update()
    },
    setWatched(watched: string[]) {
      state = { ...state, currency: { currencyWalletIds: watched } }
      manager.update()
    },
    write(i: number) {
      const repo = db.repos.get(hexes[i])
      if (repo == null) throw new Error('No repo')
      repo[`w${Date.now()}${Math.random()}.json`] = box
      db.touchRepo(hexes[i], 1)
    },
    destroy() {
      destroyed = true
      manager.destroy()
    }
  }
}

type Harness = ManagerHarness

function allListening(h: Harness): boolean {
  return h.ids.every((_, i) => h.status(i) === 'listening')
}

describe('repo change manager', function () {
  let harness: Harness | undefined
  afterEach(function () {
    harness?.destroy()
    harness = undefined
    Object.assign(syncServerConfig, savedServerConfig)
    Object.assign(storageSyncConfig, savedStorageConfig)
  })

  it('subscribes in batches of 100, and opens a second socket past 200', async function () {
    const h = (harness = makeManagerHarness(
      Array.from({ length: 250 }, () => ({ lastHash: 'current' }))
    ))
    await waitUntil(() => allListening(h))

    const [first, second] = h.server.connections
    expect(h.server.connections.length).equals(2)
    expect(first.subscribeCalls.map(call => call.length)).deep.equals([
      100, 100
    ])
    expect(second.subscribeCalls.map(call => call.length)).deep.equals([50])
    expect(first.subscriptions.size).equals(200)
    expect(second.subscriptions.size).equals(50)

    // The order is kept, so the first repo lands in the first batch:
    expect(first.subscribeCalls[0][0][0]).equals(h.server.repoIdOf(h.hexes[0]))
    expect(second.url).equals(first.url)
  })

  it('result 1 skips the pull, and result 2 forces it', async function () {
    const h = (harness = makeManagerHarness([
      { files: 2, lastHash: 'current', syncOwed: true },
      { files: 2, lastHash: '1:1', syncOwed: true },
      { files: 2, syncOwed: true },
      { lastHash: undefined, syncOwed: true } // Not on the server yet
    ]))
    await waitUntil(() => allListening(h))
    await waitUntil(() => h.gets(1) === 1 && h.gets(2) === 1)
    await snooze(20)

    expect(h.gets(0)).equals(0)
    expect(h.gets(1)).equals(1)
    expect(h.gets(2)).equals(1)
    expect(h.gets(3)).equals(0)

    // The subscription carries the newest checkpoint, or none:
    const [call] = h.server.connections[0].subscribeCalls
    expect(call[0]).deep.equals([h.server.repoIdOf(h.hexes[0]), '2:2'])
    expect(call[2]).deep.equals([h.server.repoIdOf(h.hexes[2])])

    // Every owed first sync is settled, one way or the other:
    for (const id of h.ids) {
      expect(h.state.storageWallets[id].subscription.syncOwed).equals(false)
    }
  })

  it('an update triggers exactly one sync per repo', async function () {
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' },
      { files: 1, lastHash: 'current' },
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))

    // Several writes to two repos, all in one notification window:
    h.write(0)
    h.write(0)
    h.write(1)
    await waitUntil(() => h.gets(0) === 1 && h.gets(1) === 1)
    await waitUntil(() => allListening(h))
    await snooze(20)
    expect([h.gets(0), h.gets(1), h.gets(2)]).deep.equals([1, 1, 0])
    expect(h.server.connections[0].updates.length).equals(1)
    expect(h.server.connections[0].updates[0].length).equals(2)

    // The pulled checkpoint is now ours:
    expect(h.state.storageWallets[h.ids[0]].status.lastHash).equals(
      h.db.getRepoCheckpoint(h.hexes[0])
    )
  })

  it('ignores the echo of a checkpoint it already holds', async function () {
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))

    // Pretend we wrote this ourselves, so we already hold it:
    h.write(0)
    const checkpoint = h.db.getRepoCheckpoint(h.hexes[0])
    h.state.storageWallets[h.ids[0]].status.lastHash = checkpoint
    await waitUntil(() => h.server.connections[0].updates.length === 1)
    await snooze(20)
    expect(h.gets(0)).equals(0)
  })

  it('a disconnect restores polling, and a reconnect resubscribes everything', async function () {
    syncServerConfig.reconnectBaseMs = 20
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' },
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))
    expect(isRepoListening(h.state as any, h.ids)).equals(true)

    // The server goes away. Every repo falls back to polling:
    h.server.offline = true
    await waitUntil(() => h.ids.every((_, i) => h.status(i) === 'unsubscribed'))
    expect(isRepoListening(h.state as any, h.ids)).equals(false)
    expect(isRepoListening(h.state as any, [h.ids[0]])).equals(false)

    // A change lands while we are away:
    h.write(1)

    // The server returns, and every repo is subscribed again,
    // picking up the missed change from its checkpoint:
    h.server.offline = false
    await waitUntil(() => allListening(h) && h.gets(1) === 1, 3000)
    const reconnected = h.server.connections[h.server.connections.length - 1]
    expect(reconnected.subscriptions.size).equals(2)
    expect(h.gets(0)).equals(0)
  })

  it('subLost on one repo does not disturb the others', async function () {
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' },
      { files: 1, lastHash: 'current' },
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))
    const [connection] = h.server.connections
    expect(connection.subscribeCalls.length).equals(1)

    const seen: string[][] = []
    const lostRepoId = h.server.repoIdOf(h.hexes[1])
    connection.sendSubLost([lostRepoId])
    await waitUntil(() => {
      seen.push([h.status(0), h.status(1), h.status(2)])
      return connection.subscribeCalls.length === 2 && allListening(h)
    })

    // Only the lost repo was resubscribed, and the others never left:
    expect(connection.subscribeCalls[1]).deep.equals([[lostRepoId, '1:1']])
    for (const [a, , c] of seen) {
      expect(a).equals('listening')
      expect(c).equals('listening')
    }
  })

  it('refused subscriptions poll, and pull an owed first sync', async function () {
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current', syncOwed: true },
      { files: 1, lastHash: 'current', syncOwed: false }
    ]))
    h.server.overrideResult = () => -1
    await waitUntil(
      () => h.status(0) === 'avoiding' && h.status(1) === 'avoiding'
    )
    await waitUntil(() => h.gets(0) === 1)
    await snooze(20)
    expect(h.gets(1)).equals(0)
    expect(isRepoListening(h.state as any, [h.ids[0]])).equals(false)
  })

  it('an owed first sync runs if no socket answers in time', async function () {
    syncServerConfig.subscribeTimeoutMs = 50
    syncServerConfig.reconnectBaseMs = 10000
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current', syncOwed: true }
    ]))
    h.server.offline = true
    await waitUntil(() => h.gets(0) === 1)
    expect(h.status(0)).equals('unsubscribed')
  })

  it('a failed pull puts the repo back on polling', async function () {
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))

    // The server loses the repo, so the pull fails:
    const repo = h.db.repos.get(h.hexes[0])
    h.write(0)
    h.db.repos.delete(h.hexes[0])
    await waitUntil(() => h.status(0) === 'avoiding')
    if (repo != null) h.db.repos.set(h.hexes[0], repo)
  })

  it('holds pulls while paused, and checks the socket on resume', async function () {
    syncServerConfig.resumeProbeMs = 30
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))

    h.setPaused(true)
    h.write(0)
    await waitUntil(() => h.server.connections[0].updates.length === 1)
    await snooze(20)
    expect(h.gets(0)).equals(0)

    // On resume the held pull runs, and a silent socket is dropped
    // at the short probe deadline instead of the usual 90 seconds:
    h.server.answerPings = false
    h.setPaused(false)
    await waitUntil(() => h.gets(0) === 1)
    await waitUntil(() => h.status(0) === 'unsubscribed', 1000)
  })

  it('unsubscribes repos it stops watching, and closes an empty socket', async function () {
    const h = (harness = makeManagerHarness([
      { files: 1, lastHash: 'current' },
      { files: 1, lastHash: 'current' }
    ]))
    await waitUntil(() => allListening(h))
    const [connection] = h.server.connections

    h.setWatched([h.ids[0]])
    await waitUntil(() => connection.subscriptions.size === 1)
    expect(connection.subscriptions.has(h.server.repoIdOf(h.hexes[0]))).equals(
      true
    )

    h.setWatched([])
    await waitUntil(() => connection.closed)
  })

  it('does nothing without WebSocket servers', async function () {
    const h = (harness = makeManagerHarness(
      [{ files: 1, lastHash: 'current' }],
      {
        urls: []
      }
    ))
    await snooze(20)
    expect(h.server.connections.length).equals(0)
    expect(h.status(0)).equals('unsubscribed')
  })
})

describe('repo change helpers', function () {
  afterEach(function () {
    Object.assign(storageSyncConfig, savedStorageConfig)
  })

  it('newestCheckpoint reads the head of the ladder', function () {
    expect(newestCheckpoint(undefined)).equals(undefined)
    expect(newestCheckpoint('')).equals(undefined)
    expect(newestCheckpoint('7:28')).equals('7:28')
    expect(newestCheckpoint('7:28,6:21,5:15')).equals('7:28')
  })

  it('listWatchedRepos puts account repos first and skips unsynced repos', function () {
    const wallet = (lastSync: number): any => ({ status: { lastSync } })
    const state: any = {
      accountIds: ['a'],
      accounts: { a: { accountWalletInfos: [{ id: 'acct' }] } },
      currency: { currencyWalletIds: ['w1', 'acct', 'w2', 'w3'] },
      storageWallets: {
        acct: wallet(1),
        w1: wallet(1),
        w2: wallet(0)
      }
    }
    expect(listWatchedRepos(state)).deep.equals(['acct', 'w1'])
  })

  it('isRepoListening needs every repo listening', function () {
    const sub = (status: string): any => ({ subscription: { status } })
    const state: any = {
      storageWallets: {
        a: sub('listening'),
        b: sub('syncing'),
        c: sub('avoiding')
      }
    }
    expect(isRepoListening(state, [])).equals(false)
    expect(isRepoListening(state, ['a', 'b'])).equals(true)
    expect(isRepoListening(state, ['a', 'c'])).equals(false)
    expect(isRepoListening(state, ['a', 'missing'])).equals(false)
  })

  it('the polling task stops while listening', async function () {
    storageSyncConfig.syncInterval = 10
    let runs = 0
    const task = makeRepoPollingTask(async () => {
      ++runs
    })
    task.update(false)
    await waitUntil(() => runs >= 2)

    task.update(true)
    await snooze(10)
    const stopped = runs
    await snooze(50)
    expect(runs).equals(stopped)

    // A repeated state changes nothing:
    task.update(true)
    task.stop()
  })
})
