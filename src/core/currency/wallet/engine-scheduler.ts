/**
 * Limits how many wallets may run their heavy engine-startup work
 * (repo sync, key derivation, `makeCurrencyEngine`) at once.
 *
 * Only wallets that already emitted their API object from the UI-state
 * cache enter this queue - a wallet with no cache needs its startup work
 * before it can emit at all, so it bypasses the queue and first-login
 * behavior stays identical to the pre-cache flow.
 *
 * This module has no dependencies, so anything in the core can import it
 * without creating require cycles.
 */

/** Tests override these to make queue behavior observable. */
export const engineSchedulerConfig = {
  /** How many queued wallets may run their startup work at once: */
  concurrency: 8,

  /**
   * A watchdog force-releases any slot held longer than this,
   * so one wedged wallet (a hung repo sync or plugin) cannot
   * permanently shrink the pool and starve the queue. The wedged
   * wallet's work keeps running; the queue just stops waiting for
   * it, temporarily admitting one extra wallet - the same unbounded
   * behavior every wallet had before this queue existed.
   */
  slotTimeoutMs: 30000,

  /**
   * How long a bump for a not-yet-queued wallet stays valid. Engine-
   * backed method calls keep bumping wallets long after startup, so
   * without an expiry every wallet would look "asked for" by the next
   * login and the priority signal would mean nothing.
   */
  stickyBumpTtlMs: 30000
}

export interface EngineScheduler {
  /**
   * Waits for a free startup slot, then resolves with a `release`
   * callback. Call `release` (idempotent) once the startup work
   * settles. `onTimeout` fires if the watchdog reclaims the slot
   * before `release` is called.
   */
  readonly acquire: (
    walletId: string,
    onTimeout?: () => void
  ) => Promise<() => void>

  /**
   * Moves a queued wallet to the front of the line, such as when the
   * user opens the wallet or calls one of its engine-backed methods.
   * A wallet that has not reached the queue yet is remembered, and
   * enters at the front when it arrives. Returns true if the wallet
   * actually moved, and false otherwise.
   */
  readonly bump: (walletId: string) => boolean
}

interface QueueEntry {
  walletId: string
  start: () => void
}

function makeEngineScheduler(): EngineScheduler {
  let running = 0
  const queue: QueueEntry[] = []

  // Wallets asked-for before their startup work reached the queue,
  // stamped with the time of the ask. Consumed when the wallet
  // acquires; bounded by the account's wallet count:
  const stickyBumps = new Map<string, number>()

  function startNext(): void {
    while (running < engineSchedulerConfig.concurrency && queue.length > 0) {
      const entry = queue.shift()
      if (entry == null) return
      running++
      entry.start()
    }
  }

  return {
    async acquire(walletId, onTimeout) {
      let released = false
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const release = (): void => {
        if (released) return
        released = true
        if (watchdog != null) clearTimeout(watchdog)
        running--
        startNext()
      }
      const takeSlot = (): (() => void) => {
        stickyBumps.delete(walletId)
        watchdog = setTimeout(() => {
          if (onTimeout != null) onTimeout()
          release()
        }, engineSchedulerConfig.slotTimeoutMs)
        // Do not hold the process open just for the watchdog (the
        // unref method exists on Node timers, not React Native's):
        const unrefable = watchdog as { unref?: () => void }
        if (unrefable.unref != null) unrefable.unref()
        return release
      }

      if (running < engineSchedulerConfig.concurrency && queue.length === 0) {
        running++
        return takeSlot()
      }

      await new Promise<void>(resolve => {
        const entry = { walletId, start: resolve }
        // A recent bump for this wallet means "the user wants it",
        // so it enters at the front of the line:
        const bumpedAt = stickyBumps.get(walletId)
        stickyBumps.delete(walletId)
        if (
          bumpedAt != null &&
          Date.now() - bumpedAt < engineSchedulerConfig.stickyBumpTtlMs
        ) {
          queue.unshift(entry)
        } else {
          queue.push(entry)
        }
      })
      return takeSlot()
    },

    bump(walletId) {
      const index = queue.findIndex(entry => entry.walletId === walletId)
      if (index < 0) {
        // Not queued (yet): remember the request, so a wallet whose
        // startup work is still reading its cache files gets its
        // priority when it does join the queue:
        stickyBumps.set(walletId, Date.now())
        return false
      }
      if (index === 0) return false
      const [entry] = queue.splice(index, 1)
      queue.unshift(entry)
      return true
    }
  }
}

/**
 * One scheduler per core context. The `io` object is created once per
 * context and threads through every pixie's props, so it works as the
 * context identity without new plumbing:
 */
const schedulers = new WeakMap<object, EngineScheduler>()

export function getEngineScheduler(io: object): EngineScheduler {
  let scheduler = schedulers.get(io)
  if (scheduler == null) {
    scheduler = makeEngineScheduler()
    schedulers.set(io, scheduler)
  }
  return scheduler
}
