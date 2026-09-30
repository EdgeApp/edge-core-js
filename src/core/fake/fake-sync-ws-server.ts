import { base16 } from 'rfc4648'

import { syncKeyToRepoId } from '../storage/repo'
import {
  SyncSocket,
  SyncSocketFactory
} from '../storage/sync-server-connection'
import {
  syncProtocol,
  SyncSubscribeParams,
  SyncSubscribeResult,
  SyncUpdateParams
} from '../storage/sync-server-protocol'
import { FakeDb } from './fake-db'

/** Most repos one `subscribeRepos` call may carry. */
const MAX_SUBSCRIBE_PARAMS = 100

/** Most repos one connection may hold. Overflow entries get `0`. */
const MAX_CONNECTION_SUBSCRIPTIONS = 200

export interface FakeSyncWsConnection {
  readonly id: number
  readonly url: string

  /** Every accepted `subscribeRepos` call, in arrival order. */
  readonly subscribeCalls: SyncSubscribeParams[][]

  /** Every `subscribeRepos` call refused by the rate limit. */
  readonly rejectedCalls: SyncSubscribeParams[][]

  /** Every `update` sent, in order. */
  readonly updates: SyncUpdateParams[][]

  /** Repo IDs subscribed, with the checkpoint last reported. */
  readonly subscriptions: Map<string, string>

  readonly closed: boolean

  /** Sends `subLost` for these repos, and forgets them. */
  sendSubLost: (repoIds: string[]) => void

  /** Closes the socket from the server side. */
  close: () => void
}

/**
 * An in-memory stand-in for the sync server's `/api/v2/ws` endpoint,
 * reading checkpoints from the same `FakeDb` as the fake REST server.
 */
export interface FakeSyncWsServer {
  /** Hand this to the context in place of the global `WebSocket`. */
  readonly makeSocket: SyncSocketFactory

  /** Every connection ever opened, in order. */
  readonly connections: FakeSyncWsConnection[]

  /** Set false to leave pings unanswered, like a half-open socket. */
  answerPings: boolean

  /** Set true to refuse new sockets and close the open ones. */
  offline: boolean

  /**
   * Most `subscribeRepos` calls per connection per minute,
   * like the real server. Calls past it fail with an error.
   */
  subscribeCallsPerMinute: number

  /**
   * Overrides the result for one subscription.
   * Return undefined to use the checkpoint comparison.
   */
  overrideResult:
    | ((repoId: string, checkpoint?: string) => SyncSubscribeResult | undefined)
    | undefined

  /** The repo ID for a sync key in `FakeDb` form (lowercase hex). */
  repoIdOf: (syncKey: string) => string
}

export function makeFakeSyncWsServer(db: FakeDb): FakeSyncWsServer {
  const repoIds = new Map<string, string>() // syncKey -> repoId
  let nextId = 0

  function repoIdOf(syncKey: string): string {
    let repoId = repoIds.get(syncKey)
    if (repoId == null) {
      repoId = syncKeyToRepoId(base16.parse(syncKey.toUpperCase()))
      repoIds.set(syncKey, repoId)
    }
    return repoId
  }

  function checkpointOf(repoId: string): string {
    for (const syncKey of Array.from(db.repos.keys())) {
      if (repoIdOf(syncKey) === repoId) return db.getRepoCheckpoint(syncKey)
    }
    return '0:0'
  }

  const liveNotifiers = new Set<(syncKey: string) => void>()
  db.repoListeners.add(syncKey => {
    liveNotifiers.forEach(notify => notify(syncKey))
  })

  function makeSocket(url: string): SyncSocket {
    const listeners: { [type: string]: Array<(event: any) => void> } = {
      close: [],
      error: [],
      message: [],
      open: []
    }
    const emit = (type: string, event: unknown = {}): void => {
      for (const listener of listeners[type]) listener(event)
    }

    let closed = false
    const subscriptions = new Map<string, string>()
    const subscribeCalls: SyncSubscribeParams[][] = []
    const rejectedCalls: SyncSubscribeParams[][] = []
    let callTimes: number[] = []
    const updates: SyncUpdateParams[][] = []
    let pendingUpdates = new Map<string, string>()
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const codec = syncProtocol.makeServerCodec({
      handleError() {},

      async handleSend(text) {
        if (closed) return
        setTimeout(() => {
          if (!closed) emit('message', { data: text })
        }, 0)
      },

      localMethods: {
        async subscribeRepos(params) {
          if (params.length > MAX_SUBSCRIBE_PARAMS) {
            throw new Error(`Too many repos: ${params.length}`)
          }
          const now = Date.now()
          callTimes = callTimes.filter(time => now - time < 60 * 1000)
          if (callTimes.length >= out.subscribeCallsPerMinute) {
            rejectedCalls.push(params)
            throw new Error('Too many subscribe calls')
          }
          callTimes.push(now)
          subscribeCalls.push(params)
          return params.map(([repoId, checkpoint]): SyncSubscribeResult => {
            if (
              !subscriptions.has(repoId) &&
              subscriptions.size >= MAX_CONNECTION_SUBSCRIPTIONS
            ) {
              return 0
            }
            const current = checkpointOf(repoId)
            subscriptions.set(repoId, current)
            const override = out.overrideResult?.(repoId, checkpoint)
            if (override != null) return override
            return (checkpoint ?? '0:0') === current ? 1 : 2
          })
        },

        async unsubscribeRepos(params) {
          for (const [repoId] of params) subscriptions.delete(repoId)
          return undefined
        },

        async ping() {
          if (!out.answerPings) return await new Promise<'pong'>(() => {})
          return 'pong' as const
        }
      }
    })

    // Batches changes into one `update`, like the real server:
    function notify(syncKey: string): void {
      const repoId = repoIdOf(syncKey)
      const last = subscriptions.get(repoId)
      if (last == null) return
      const checkpoint = db.getRepoCheckpoint(syncKey)
      if (checkpoint === last) return
      subscriptions.set(repoId, checkpoint)
      pendingUpdates.set(repoId, checkpoint)
      if (flushTimer != null) return
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        const params: SyncUpdateParams[] = []
        pendingUpdates.forEach((checkpoint, repoId) =>
          params.push([repoId, checkpoint])
        )
        pendingUpdates = new Map()
        if (closed || params.length === 0) return
        updates.push(params)
        codec.remoteMethods.update(params)
      }, 0)
    }

    function shut(): void {
      if (closed) return
      closed = true
      liveNotifiers.delete(notify)
      if (flushTimer != null) clearTimeout(flushTimer)
      codec.handleClose()
      setTimeout(() => emit('close'), 0)
    }

    const connection: FakeSyncWsConnection = {
      id: nextId++,
      url,
      subscribeCalls,
      rejectedCalls,
      updates,
      subscriptions,
      get closed() {
        return closed
      },
      sendSubLost(repoIds) {
        for (const repoId of repoIds) subscriptions.delete(repoId)
        codec.remoteMethods.subLost(repoIds.map((id): [string] => [id]))
      },
      close: shut
    }

    setTimeout(() => {
      if (out.offline) {
        closed = true
        emit('error')
        emit('close')
        return
      }
      out.connections.push(connection)
      liveNotifiers.add(notify)
      emit('open')
    }, 0)

    return {
      addEventListener(type, listener) {
        listeners[type].push(listener)
      },
      close: shut,
      send(text) {
        if (closed) return
        setTimeout(() => {
          if (!closed) codec.handleMessage(text)
        }, 0)
      }
    }
  }

  let offline = false
  const out: FakeSyncWsServer = {
    makeSocket,
    connections: [],
    answerPings: true,
    subscribeCallsPerMinute: 10,
    get offline() {
      return offline
    },
    set offline(value: boolean) {
      offline = value
      if (value) {
        for (const connection of out.connections) connection.close()
      }
    },
    overrideResult: undefined,
    repoIdOf
  }
  return out
}
