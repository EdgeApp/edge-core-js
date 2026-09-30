import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { FakeDb } from '../../../src/core/fake/fake-db'
import { makeFakeSyncWsServer } from '../../../src/core/fake/fake-sync-ws-server'
import { makeLog } from '../../../src/core/log/log'
import {
  connectSyncServer,
  deriveSyncWebSocketServers,
  makeSyncHostPicker,
  SyncServerCallbacks,
  syncServerConfig,
  SyncSocket,
  toSyncWebSocketUrl
} from '../../../src/core/storage/sync-server-connection'
import { startSyncServerHeartbeat } from '../../../src/core/storage/sync-server-heartbeat'
import { syncProtocol } from '../../../src/core/storage/sync-server-protocol'
import { snooze } from '../../../src/util/snooze'
import { expectRejection } from '../../expect-rejection'
import { waitUntil } from '../../wait-until'

const savedServerConfig = { ...syncServerConfig }
const log = makeLog({ onLog() {} }, 'test')

function makeCallbacks(): SyncServerCallbacks & { events: string[] } {
  const events: string[] = []
  return {
    events,
    handleConnect: () => events.push('connect'),
    handleDisconnect: () => events.push('disconnect'),
    handleSubLost: params => events.push(`subLost ${JSON.stringify(params)}`),
    handleUpdate: params => events.push(`update ${JSON.stringify(params)}`)
  }
}

/** A socket that never opens, and records its URL. */
function makeDeadSocketFactory(urls: string[]) {
  return (url: string): SyncSocket => {
    urls.push(url)
    const listeners: Array<(event: unknown) => void> = []
    setTimeout(() => listeners.forEach(listener => listener({})), 0)
    return {
      addEventListener(type, listener) {
        if (type === 'close') listeners.push(listener)
      },
      close() {},
      send() {}
    }
  }
}

describe('sync-server urls', function () {
  it('swaps http for ws and adds the path', function () {
    expect(toSyncWebSocketUrl('https://sync-us1.edge.app')).equals(
      'wss://sync-us1.edge.app/api/v2/ws'
    )
    expect(toSyncWebSocketUrl('https://sync-us1.edge.app/')).equals(
      'wss://sync-us1.edge.app/api/v2/ws'
    )
    expect(toSyncWebSocketUrl('http://127.0.0.1:8010')).equals(
      'ws://127.0.0.1:8010/api/v2/ws'
    )
    expect(toSyncWebSocketUrl('ws://127.0.0.1:8010')).equals(
      'ws://127.0.0.1:8010/api/v2/ws'
    )
    expect(toSyncWebSocketUrl('ws://127.0.0.1:8010/api/v2/ws')).equals(
      'ws://127.0.0.1:8010/api/v2/ws'
    )
  })

  it('leaves out sync-eu unless nothing else is left', function () {
    expect(
      deriveSyncWebSocketServers([
        'https://sync-us1.edge.app',
        'https://sync-eu.edge.app',
        'https://sync-us2.edge.app'
      ])
    ).deep.equals([
      'wss://sync-us1.edge.app/api/v2/ws',
      'wss://sync-us2.edge.app/api/v2/ws'
    ])
    expect(
      deriveSyncWebSocketServers(['https://sync-eu.edge.app'])
    ).deep.equals(['wss://sync-eu.edge.app/api/v2/ws'])
  })
})

describe('sync-server connection', function () {
  afterEach(function () {
    Object.assign(syncServerConfig, savedServerConfig)
  })

  it('pins one host, and rotates after repeated failures', async function () {
    syncServerConfig.reconnectBaseMs = 1
    syncServerConfig.reconnectMaxMs = 1
    const hosts = makeSyncHostPicker(['ws://a', 'ws://b', 'ws://c'], () => 0)
    const urls: string[] = []
    const connection = connectSyncServer({
      callbacks: makeCallbacks(),
      hosts,
      log,
      makeSocket: makeDeadSocketFactory(urls)
    })
    await waitUntil(() => urls.length >= 5)
    connection.close()
    expect(urls.slice(0, 5)).deep.equals([
      'ws://a',
      'ws://a',
      'ws://b',
      'ws://b',
      'ws://c'
    ])

    // A second failure report for a host we already left changes nothing:
    const picker = makeSyncHostPicker(['ws://a', 'ws://b'], () => 0)
    picker.rotate('ws://a')
    picker.rotate('ws://a')
    expect(picker.current()).equals('ws://b')
    expect(() => makeSyncHostPicker([])).to.throw('No sync WebSocket servers')
  })

  it('backs off exponentially, and survives a throwing socket factory', async function () {
    syncServerConfig.reconnectBaseMs = 20
    syncServerConfig.reconnectMaxMs = 40
    let attempts = 0
    const connection = connectSyncServer({
      callbacks: makeCallbacks(),
      hosts: makeSyncHostPicker(['ws://a']),
      log,
      makeSocket() {
        ++attempts
        throw new Error('No network')
      }
    })
    await snooze(150)
    connection.close()
    const settled = attempts
    // Bounded by the ceiling, but not a tight loop:
    expect(attempts).greaterThan(1)
    expect(attempts).lessThan(40)
    await snooze(60)
    expect(attempts).equals(settled)
  })

  it('reports updates and lost subscriptions, and decodes binary frames', async function () {
    const callbacks = makeCallbacks()
    let server: ReturnType<typeof syncProtocol.makeServerCodec> | undefined
    let emitMessage: (data: unknown) => void = () => {}
    const connection = connectSyncServer({
      callbacks,
      hosts: makeSyncHostPicker(['ws://a']),
      log,
      makeSocket() {
        const listeners: { [type: string]: Array<(event: any) => void> } = {
          close: [],
          error: [],
          message: [],
          open: []
        }
        emitMessage = data => listeners.message.forEach(l => l({ data }))
        server = syncProtocol.makeServerCodec({
          handleError() {},
          async handleSend(text) {
            // Send as bytes, as a binary frame would arrive:
            emitMessage(new TextEncoder().encode(text).buffer)
          },
          localMethods: {
            async subscribeRepos(params) {
              return params.map(() => 1 as const)
            },
            async unsubscribeRepos() {
              return undefined
            },
            async ping() {
              return 'pong' as const
            }
          }
        })
        setTimeout(() => listeners.open.forEach(l => l({})), 0)
        return {
          addEventListener(type, listener) {
            listeners[type].push(listener)
          },
          close() {},
          send(text) {
            setTimeout(() => server?.handleMessage(text), 0)
          }
        }
      }
    })
    await expectRejection(
      connection.subscribe([['repo']]),
      'Error: syncServer socket is not connected'
    )
    await waitUntil(() => connection.connected)
    expect(connection.epoch).equals(1)
    expect(await connection.subscribe([['repo', '1:1']])).deep.equals([1])
    await connection.unsubscribe(['repo'])

    server?.remoteMethods.update([['repo', '2:2']])
    server?.remoteMethods.subLost([['repo']])
    await waitUntil(() => callbacks.events.length === 3)
    expect(callbacks.events).deep.equals([
      'connect',
      'update [["repo","2:2"]]',
      'subLost [["repo"]]'
    ])

    // Liveness checks on a healthy socket just ping:
    connection.checkLiveness()
    await snooze(10)
    expect(connection.connected).equals(true)
    connection.close()
    connection.checkLiveness()
    expect(connection.connected).equals(false)
    await expectRejection(
      connection.unsubscribe(['repo']),
      'Error: syncServer socket is not connected'
    )
  })

  it('reconnects at once when checked while down', async function () {
    syncServerConfig.reconnectBaseMs = 60000
    syncServerConfig.reconnectMaxMs = 60000
    const db = new FakeDb()
    const server = makeFakeSyncWsServer(db)
    const callbacks = makeCallbacks()
    const connection = connectSyncServer({
      callbacks,
      hosts: makeSyncHostPicker(['ws://a']),
      log,
      makeSocket: server.makeSocket
    })
    await waitUntil(() => connection.connected)

    // The server drops us, and the next attempt is a minute out:
    server.connections[0].close()
    await waitUntil(() => !connection.connected)
    expect(callbacks.events).deep.equals(['connect', 'disconnect'])

    // Coming back to the foreground does not wait for it:
    connection.checkLiveness()
    await waitUntil(() => connection.connected, 500)
    expect(connection.epoch).equals(2)
    connection.close()
  })

  it('drops the socket when a send fails', async function () {
    const callbacks = makeCallbacks()
    const connection = connectSyncServer({
      callbacks,
      hosts: makeSyncHostPicker(['ws://a']),
      log,
      makeSocket() {
        const listeners: Array<(event: unknown) => void> = []
        setTimeout(() => listeners.forEach(l => l({})), 0)
        return {
          addEventListener(type, listener) {
            if (type === 'open') listeners.push(listener)
          },
          close() {},
          send() {
            throw new Error('Socket broke')
          }
        }
      }
    })
    await waitUntil(() => connection.connected)
    await expectRejection(
      connection.subscribe([['repo']]),
      'Error: JSON-RPC connection closed'
    )
    expect(connection.connected).equals(false)
    expect(callbacks.events).deep.equals(['connect', 'disconnect'])
    connection.close()
  })
})

describe('sync-server heartbeat', function () {
  it('stays alive while pongs arrive, and dies without them', async function () {
    let answer = true
    let dead = 0
    const heartbeat = startSyncServerHeartbeat({
      intervalMs: 10,
      deadlineMs: 40,
      onDead: () => ++dead,
      ping: async () => (answer ? 'pong' : await new Promise<'pong'>(() => {}))
    })
    await snooze(100)
    expect(dead).equals(0)

    answer = false
    await waitUntil(() => dead === 1, 500)
    await snooze(60)
    expect(dead).equals(1)

    // Stopped heartbeats ignore everything:
    heartbeat.alive()
    heartbeat.probe(1)
    heartbeat.stop()
    await snooze(10)
    expect(dead).equals(1)
  })

  it('a probe shortens the deadline', async function () {
    let dead = 0
    const heartbeat = startSyncServerHeartbeat({
      intervalMs: 1000,
      deadlineMs: 1000,
      onDead: () => ++dead,
      ping: async () => await new Promise<'pong'>(() => {})
    })
    heartbeat.probe(20)
    await waitUntil(() => dead === 1, 500)
    heartbeat.stop()
  })
})
