import { Disklet, makeMemoryDisklet } from 'disklet'
import { base16, base64 } from 'rfc4648'
import { makeFetchFunction } from 'serverlet'

import { getInternalStuff } from '../../../src/core/context/internal-api'
import { FakeDb } from '../../../src/core/fake/fake-db'
import { makeFakeServer } from '../../../src/core/fake/fake-server'
import {
  FakeSyncWsConnection,
  FakeSyncWsServer,
  makeFakeSyncWsServer
} from '../../../src/core/fake/fake-sync-ws-server'
import { makeContext } from '../../../src/core/root'
import { RootState } from '../../../src/core/root-reducer'
import { syncKeyToRepoId } from '../../../src/core/storage/repo'
import { makeFakeIo } from '../../../src/index'
import { asEdgeLoginDump, asEdgeRepoDump } from '../../../src/types/fake-types'
import { EdgeContext, EdgeFetchFunction } from '../../../src/types/types'
import { fakeUser } from '../../fake/fake-user'

export const accountSyncKey = base64.parse(fakeUser.syncKey)
export const accountSyncKeyHex = base16.stringify(accountSyncKey).toLowerCase()
export const accountRepoId = syncKeyToRepoId(accountSyncKey)

export interface StoreGate {
  /** While set, `GET /api/v2/store` requests wait on this. */
  reads?: Promise<void>

  /** Counts `GET /api/v2/store` requests, by lowercase sync key. */
  readonly getCounts: Map<string, number>

  /** Counts reads parked on the gate. */
  parked: number
}

export interface SyncWsHarness {
  db: FakeDb
  server: FakeSyncWsServer

  /**
   * Builds a context on the given disk, so a test can "crash" one
   * context and launch another on the same device.
   */
  makeContext: (opts?: {
    disklet?: Disklet
    gate?: StoreGate
  }) => Promise<EdgeContext>
}

export function makeStoreGate(): StoreGate {
  return { getCounts: new Map(), parked: 0 }
}

export function makeSyncWsHarness(): SyncWsHarness {
  const db = new FakeDb()
  db.setupLogin(asEdgeLoginDump(fakeUser.server))
  for (const syncKey of Object.keys(fakeUser.repos)) {
    db.setupRepo(syncKey, asEdgeRepoDump(fakeUser.repos[syncKey]))
  }
  const fakeFetch = makeFetchFunction(makeFakeServer(db))
  const server = makeFakeSyncWsServer(db)

  return {
    db,
    server,
    async makeContext(opts = {}) {
      const { disklet = makeMemoryDisklet(), gate = makeStoreGate() } = opts
      const fetch: EdgeFetchFunction = async (uri, init) => {
        const match = /\/api\/v2\/store\/([0-9a-f]+)/.exec(uri)
        const method = init?.method ?? 'GET'
        if (match != null && method === 'GET') {
          const syncKey = match[1]
          gate.getCounts.set(syncKey, (gate.getCounts.get(syncKey) ?? 0) + 1)
          if (gate.reads != null) {
            ++gate.parked
            await gate.reads
          }
        }
        return await fakeFetch(uri, init)
      }
      const io = { ...makeFakeIo(), disklet, fetch }
      return await makeContext(
        { io, nativeIo: {} },
        { onLog() {} },
        { apiKey: '', appId: '' },
        { makeSyncSocket: server.makeSocket }
      )
    }
  }
}

export function getState(context: EdgeContext): RootState {
  return getInternalStuff(context)._ai.props.state
}

export function lastConnection(server: FakeSyncWsServer): FakeSyncWsConnection {
  const { connections } = server
  if (connections.length === 0) throw new Error('No connections')
  return connections[connections.length - 1]
}
