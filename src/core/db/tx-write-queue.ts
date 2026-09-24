import { EdgeTx } from '../../types/types'
import { EdgeTxRef } from './account-database'
import { EdgeSqlDriver } from './db-driver'
import { saveTxs } from './tx-writer'

/**
 * One wallet's transaction writes, in order, until each one lands.
 *
 * An engine reports a transaction again only when it changes, so a batch
 * this queue drops is a transaction the database never sees. A failed write
 * is therefore retried rather than logged and forgotten: reported once, then
 * tried again after a second, doubling to thirty. The batches behind it
 * wait, so the rows always land in the order the engine reported them.
 *
 * `push` resolves when its batch has committed, which is what lets a caller
 * read the batch back before telling anyone about it.
 */

export const txWriteQueueConfig = {
  firstRetryMs: 1000,
  maxRetryMs: 30000,
  /** Test hook: runs before every write attempt; throwing fails it. */
  beforeSave: undefined as (() => void) | undefined,
  /** Test hook: told each retry delay as it starts. */
  onRetry: undefined as ((delayMs: number) => void) | undefined
}

export interface TxWriteQueue {
  push: (txs: EdgeTx[]) => Promise<void>

  /**
   * Stops the queue for good, at logout.
   *
   * Pending pushes never settle: nothing may run for a wallet that is gone.
   * A batch still unwritten is logged, not reported as an error, since after
   * logout an error has nobody left to go to.
   */
  stop: () => void
}

export interface TxWriteQueueOptions {
  driver: EdgeSqlDriver
  changed: (refs: EdgeTxRef[]) => void
  onError: (error: unknown) => void
  warn: (message: string) => void
  walletId: string
}

interface Job {
  txs: EdgeTx[]
  resolve: () => void
}

export function makeTxWriteQueue(opts: TxWriteQueueOptions): TxWriteQueue {
  const { driver, changed, onError, warn, walletId } = opts
  const jobs: Job[] = []
  let running = false
  // An object, because `stop` flips it while `run` is awaiting:
  const state = { stopped: false }
  let wake: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Waits out a retry delay, or less if the queue is stopped meanwhile. */
  async function sleep(ms: number): Promise<void> {
    await new Promise<void>(resolve => {
      wake = resolve
      timer = setTimeout(resolve, ms)
    })
    wake = undefined
    timer = undefined
  }

  async function run(): Promise<void> {
    if (running) return
    running = true
    while (jobs.length > 0 && !state.stopped) {
      const job = jobs[0]
      let delayMs = txWriteQueueConfig.firstRetryMs
      let reported = false
      while (!state.stopped) {
        try {
          txWriteQueueConfig.beforeSave?.()
          await saveTxs(driver, job.txs)
          break
        } catch (error: unknown) {
          if (!reported) {
            reported = true
            onError(error)
          }
          txWriteQueueConfig.onRetry?.(delayMs)
          await sleep(delayMs)
          delayMs = Math.min(delayMs * 2, txWriteQueueConfig.maxRetryMs)
        }
      }
      if (state.stopped) break
      jobs.shift()
      changed(job.txs.map(tx => ({ walletId: tx.walletId, txid: tx.txid })))
      job.resolve()
    }
    running = false
  }

  return {
    async push(txs) {
      if (state.stopped) return await new Promise<void>(() => {})
      return await new Promise<void>(resolve => {
        jobs.push({ txs, resolve })
        run().catch(onError)
      })
    },

    stop() {
      if (state.stopped) return
      state.stopped = true
      if (timer != null) clearTimeout(timer)
      if (wake != null) wake()
      if (jobs.length > 0) {
        const count = jobs.reduce((sum, job) => sum + job.txs.length, 0)
        warn(
          `${walletId}: logged out with ${count} transactions not yet written`
        )
      }
      jobs.length = 0
    }
  }
}

/**
 * The live queues, per context and then per wallet.
 *
 * A wallet has two callback objects -- the engine's, and the one its API
 * uses for its own writes -- and both must feed one queue, or the same
 * transaction could land out of order. Per context first, because a test
 * process can have the same wallet logged in twice.
 */
const liveQueues = new WeakMap<object, Map<string, TxWriteQueue>>()

export function walletTxWriteQueue(
  io: object,
  walletId: string,
  make: () => TxWriteQueue
): TxWriteQueue {
  let queues = liveQueues.get(io)
  if (queues == null) {
    queues = new Map()
    liveQueues.set(io, queues)
  }
  let queue = queues.get(walletId)
  if (queue == null) {
    queue = make()
    queues.set(walletId, queue)
  }
  return queue
}

/** Stops and forgets a wallet's queue, when the wallet goes away. */
export function stopWalletTxWriteQueue(io: object, walletId: string): void {
  const queues = liveQueues.get(io)
  const queue = queues?.get(walletId)
  if (queue == null) return
  queues?.delete(walletId)
  queue.stop()
}
