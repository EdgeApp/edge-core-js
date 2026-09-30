export interface SyncServerHeartbeatOpts {
  /** Sends one `ping`. Resolving counts as a sign of life. */
  ping: () => Promise<unknown>

  /** Called once if no sign of life arrives within the deadline. */
  onDead: () => void

  /** Gap between pings. */
  intervalMs: number

  /** Silence longer than this is a dead connection. */
  deadlineMs: number
}

export interface SyncServerHeartbeat {
  /** Records a sign of life, such as any incoming message. */
  alive: () => void

  /**
   * Pings right away and shortens the deadline to `deadlineMs`,
   * for when the app returns to the foreground and the socket
   * may have died while the JS engine was frozen.
   */
  probe: (deadlineMs: number) => void

  /** Stops all timers. The heartbeat never fires after this. */
  stop: () => void
}

/**
 * Detects half-open sockets, which never deliver `close` or `error`.
 * Pings on an interval, and declares the connection dead once
 * nothing has arrived for the deadline.
 */
export function startSyncServerHeartbeat(
  opts: SyncServerHeartbeatOpts
): SyncServerHeartbeat {
  const { ping, onDead, intervalMs, deadlineMs } = opts

  let stopped = false
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined

  function armDeadline(ms: number): void {
    if (deadlineTimer != null) clearTimeout(deadlineTimer)
    deadlineTimer = setTimeout(() => {
      deadlineTimer = undefined
      if (stopped) return
      out.stop()
      onDead()
    }, ms)
  }

  function sendPing(): void {
    ping().then(
      () => out.alive(),
      () => {}
    )
  }

  const pingTimer = setInterval(sendPing, intervalMs)
  armDeadline(deadlineMs)

  const out: SyncServerHeartbeat = {
    alive() {
      if (stopped) return
      armDeadline(deadlineMs)
    },

    probe(probeMs) {
      if (stopped) return
      armDeadline(probeMs)
      sendPing()
    },

    stop() {
      stopped = true
      clearInterval(pingTimer)
      if (deadlineTimer != null) clearTimeout(deadlineTimer)
      deadlineTimer = undefined
    }
  }
  return out
}
