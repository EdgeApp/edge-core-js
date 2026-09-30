import { EdgeLog } from '../../types/types'
import { utf8 } from '../../util/encoding'
import { RpcCodec } from '../../util/json-rpc'
import {
  startSyncServerHeartbeat,
  SyncServerHeartbeat
} from './sync-server-heartbeat'
import {
  syncProtocol,
  SyncSubscribeParams,
  SyncSubscribeResult,
  SyncUpdateParams
} from './sync-server-protocol'

/**
 * Timing knobs for the sync-server socket. Mutable so tests can
 * shrink them, following the `accountCacheSaverConfig` pattern.
 */
export const syncServerConfig = {
  /** Gap between heartbeat pings. */
  pingIntervalMs: 30 * 1000,

  /** Silence longer than this is a dead socket. */
  pingDeadlineMs: 90 * 1000,

  /** Deadline for the ping sent when the app returns to the foreground. */
  resumeProbeMs: 10 * 1000,

  /**
   * A socket that has not opened by this deadline is abandoned,
   * since a stalled upgrade never delivers `close` or `error`.
   */
  connectTimeoutMs: 15 * 1000,

  /** The reconnect delay doubles from this, with full jitter. */
  reconnectBaseMs: 5 * 1000,

  /** Upper bound on the reconnect delay. */
  reconnectMaxMs: 60 * 1000,

  /** Failed connect attempts in a row before trying the next host. */
  failuresBeforeRotate: 2,

  /**
   * How long a `subscribeRepos` call, or a repo waiting on its first
   * subscription, may take before the repo falls back to polling.
   */
  subscribeTimeoutMs: 15 * 1000,

  /** Newly subscribable repos gather for this long before a call. */
  subscribeDebounceMs: 500,

  /** No repo waits longer than this for its subscribe call. */
  subscribeMaxWaitMs: 2 * 1000,

  /**
   * Most `subscribeRepos` calls per connection per minute,
   * under the server's limit of 10.
   */
  subscribeCallsPerMinute: 8,

  /** A failed subscribe call retries after this, doubling each time. */
  subscribeRetryBaseMs: 5 * 1000,

  /** Upper bound on the subscribe retry delay. */
  subscribeRetryMaxMs: 60 * 1000
}

/**
 * The subset of the WebSocket API the connection uses,
 * so tests can substitute an in-memory transport.
 */
export interface SyncSocket {
  addEventListener: (
    type: 'close' | 'error' | 'message' | 'open',
    listener: (event: any) => void
  ) => void
  close: () => void
  send: (text: string) => void
}

export type SyncSocketFactory = (url: string) => SyncSocket

/**
 * Picks the sync host every socket connects to, so a client's sockets
 * all share one host, and moves to the next host on repeated failure.
 */
export interface SyncHostPicker {
  current: () => string
  rotate: (failedUrl: string) => void
}

export function makeSyncHostPicker(
  urls: string[],
  random: () => number = Math.random
): SyncHostPicker {
  if (urls.length === 0) throw new Error('No sync WebSocket servers')
  let index = Math.floor(random() * urls.length) % urls.length
  return {
    current: () => urls[index],
    rotate(failedUrl) {
      // Several sockets may fail against the same host at once,
      // but only the first report should move us along:
      if (urls[index] === failedUrl) index = (index + 1) % urls.length
    }
  }
}

export interface SyncServerCallbacks {
  handleConnect: () => void
  handleDisconnect: () => void
  handleSubLost: (params: Array<[repoId: string]>) => void
  handleUpdate: (params: SyncUpdateParams[]) => void
}

export interface SyncServerConnection {
  /** True while the socket is open and passing heartbeats. */
  readonly connected: boolean

  /**
   * Counts successful opens. A result from an earlier epoch
   * belongs to a socket that has since gone away.
   */
  readonly epoch: number

  /** True while a connect attempt waits for the socket to open. */
  readonly connecting: boolean

  /**
   * Pings now, or reconnects now if the socket is down.
   * A connect attempt still waiting to open gets a short deadline.
   */
  checkLiveness: () => void

  /** Closes the socket for good, with no further callbacks. */
  close: () => void

  subscribe: (params: SyncSubscribeParams[]) => Promise<SyncSubscribeResult[]>
  unsubscribe: (repoIds: string[]) => Promise<void>
}

interface SyncServerConnectionOpts {
  callbacks: SyncServerCallbacks
  hosts: SyncHostPicker
  log: EdgeLog
  makeSocket: SyncSocketFactory
}

type SyncCodec = RpcCodec<{
  subscribeRepos: (
    params: SyncSubscribeParams[]
  ) => Promise<SyncSubscribeResult[]>
  unsubscribeRepos: (params: Array<[repoId: string]>) => Promise<unknown>
  ping: (params: []) => Promise<'pong'>
}>

/**
 * Bundles a sync-server WebSocket and codec pair,
 * reconnecting with jittered exponential backoff until closed.
 */
export function connectSyncServer(
  opts: SyncServerConnectionOpts
): SyncServerConnection {
  const { callbacks, hosts, log, makeSocket } = opts

  let closing = false
  let connected = false
  let epoch = 0
  let failures = 0
  let generation = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: SyncServerHeartbeat | undefined
  let codec: SyncCodec | undefined
  let currentSocket: SyncSocket | undefined
  let connecting = false
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let dropCurrent: (() => void) | undefined

  function armConnectDeadline(ms: number): void {
    if (connectTimer != null) clearTimeout(connectTimer)
    connectTimer = setTimeout(() => {
      connectTimer = undefined
      if (!connecting) return
      log.warn(`syncServer ${hosts.current()} did not open in time`)
      dropCurrent?.()
    }, ms)
  }

  function clearConnectDeadline(): void {
    if (connectTimer != null) clearTimeout(connectTimer)
    connectTimer = undefined
  }

  function connect(): void {
    reconnectTimer = undefined
    if (closing) return
    const gen = ++generation
    const url = hosts.current()
    let opened = false

    let socket: SyncSocket
    try {
      socket = makeSocket(url)
    } catch (error: unknown) {
      log.warn(`syncServer ${url} failed to open: ${String(error)}`)
      fail(url)
      return
    }

    const socketCodec: SyncCodec = syncProtocol.makeClientCodec({
      // We failed to send a message, so shut down the socket:
      handleError(error) {
        log.warn(`syncServer ${url} send failed: ${String(error)}`)
        drop()
      },

      async handleSend(text) {
        socket.send(text)
      },

      localMethods: {
        update(params) {
          callbacks.handleUpdate(params)
        },
        subLost(params) {
          callbacks.handleSubLost(params)
        }
      }
    })
    codec = socketCodec
    currentSocket = socket
    connecting = true
    dropCurrent = drop
    armConnectDeadline(syncServerConfig.connectTimeoutMs)

    /**
     * Retires this socket. Stale events from it are ignored afterwards,
     * so a half-open socket whose `close` never arrives cannot linger.
     */
    function drop(): void {
      if (gen !== generation) return
      ++generation
      connecting = false
      dropCurrent = undefined
      clearConnectDeadline()
      heartbeat?.stop()
      heartbeat = undefined
      codec = undefined
      currentSocket = undefined
      const wasConnected = connected
      connected = false
      socketCodec.handleClose()
      try {
        socket.close()
      } catch (error: unknown) {}
      if (wasConnected) callbacks.handleDisconnect()
      if (opened) {
        ++failures
        scheduleReconnect()
      } else {
        fail(url)
      }
    }

    socket.addEventListener('open', () => {
      if (gen !== generation) return
      opened = true
      connecting = false
      clearConnectDeadline()
      connected = true
      ++epoch
      heartbeat = startSyncServerHeartbeat({
        ping: async () => await socketCodec.remoteMethods.ping([]),
        onDead() {
          log.warn(`syncServer ${url} missed its heartbeat deadline`)
          drop()
        },
        intervalMs: syncServerConfig.pingIntervalMs,
        deadlineMs: syncServerConfig.pingDeadlineMs
      })
      callbacks.handleConnect()
    })

    socket.addEventListener('message', (event: { data: unknown }) => {
      if (gen !== generation) return
      // Any traffic proves the socket works:
      failures = 0
      heartbeat?.alive()
      const { data } = event
      socketCodec.handleMessage(
        typeof data === 'string'
          ? data
          : utf8.stringify(new Uint8Array(data as ArrayBuffer))
      )
    })

    socket.addEventListener('close', () => drop())
    socket.addEventListener('error', () => drop())
  }

  /** A connect attempt that never opened. */
  function fail(url: string): void {
    ++failures
    if (failures % syncServerConfig.failuresBeforeRotate === 0) {
      hosts.rotate(url)
    }
    scheduleReconnect()
  }

  function scheduleReconnect(): void {
    if (closing || reconnectTimer != null) return
    const { reconnectBaseMs, reconnectMaxMs } = syncServerConfig
    const ceiling = Math.min(
      reconnectMaxMs,
      reconnectBaseMs * 2 ** Math.max(0, failures - 1)
    )
    // Full jitter, so a server restart does not bring every client
    // back in the same instant:
    reconnectTimer = setTimeout(connect, Math.random() * ceiling)
  }

  function getCodec(): SyncCodec {
    if (codec == null || !connected) {
      throw new Error('syncServer socket is not connected')
    }
    return codec
  }

  const out: SyncServerConnection = {
    get connected() {
      return connected
    },

    get epoch() {
      return epoch
    },

    get connecting() {
      return connecting
    },

    checkLiveness() {
      if (closing) return
      if (connected) {
        heartbeat?.probe(syncServerConfig.resumeProbeMs)
      } else if (connecting) {
        armConnectDeadline(syncServerConfig.resumeProbeMs)
      } else if (reconnectTimer != null) {
        clearTimeout(reconnectTimer)
        connect()
      }
    },

    close() {
      closing = true
      ++generation
      connecting = false
      dropCurrent = undefined
      clearConnectDeadline()
      if (reconnectTimer != null) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      heartbeat?.stop()
      heartbeat = undefined
      codec?.handleClose()
      codec = undefined
      connected = false
      try {
        currentSocket?.close()
      } catch (error: unknown) {}
      currentSocket = undefined
    },

    async subscribe(params) {
      return await getCodec().remoteMethods.subscribeRepos(params)
    },

    async unsubscribe(repoIds) {
      await getCodec().remoteMethods.unsubscribeRepos(
        repoIds.map((repoId): [string] => [repoId])
      )
    }
  }

  connect()
  return out
}

/** Where the sync server accepts WebSocket upgrades. */
export const SYNC_WEBSOCKET_PATH = '/api/v2/ws'

/**
 * Turns a sync server address into its WebSocket endpoint:
 * `http` becomes `ws`, `https` becomes `wss`, and a bare host
 * gains the `/api/v2/ws` path. String-based, since the React Native
 * `URL` polyfill cannot change a protocol.
 */
export function toSyncWebSocketUrl(server: string): string {
  const url = server.replace(/^http(s?):/i, 'ws$1:')
  const match = /^(wss?:\/\/[^/?#]+)\/?$/i.exec(url)
  return match == null ? url : match[1] + SYNC_WEBSOCKET_PATH
}

/**
 * Chooses the WebSocket hosts for the sync servers. The socket replaces
 * polling, so it stays on the US cluster, which replicates instantly,
 * rather than `sync-eu`, which trails it. Falls back to every host
 * if the list has no US host.
 */
export function deriveSyncWebSocketServers(syncServers: string[]): string[] {
  const urls = syncServers.map(toSyncWebSocketUrl)
  const primary = urls.filter(url => !/^wss?:\/\/sync-eu\b/i.test(url))
  return primary.length > 0 ? primary : urls
}
