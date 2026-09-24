import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { EdgeTxRef } from '../../../src/core/db/account-database'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  makeTxWriteQueue,
  stopWalletTxWriteQueue,
  TxWriteQueue,
  txWriteQueueConfig,
  walletTxWriteQueue
} from '../../../src/core/db/tx-write-queue'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTx } from '../../../src/types/types'

/**
 * A wallet's transaction writes.
 *
 * An engine reports a transaction again only when it changes, so a write this
 * queue gave up on would be a transaction the database never has. These lock
 * the retry, the order, and what stopping at logout does and does not do.
 */

function makeTx(txid: string): EdgeTx {
  return {
    walletId: 'wallet',
    txid,
    pluginId: 'fakecoin',
    date: new Date('2026-01-01T00:00:00Z').toISOString(),
    blockHeight: 1,
    isSend: false,
    nativeAmounts: new Map([[null, '1']]),
    networkFees: new Map([[null, '0']]),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map()
  } as unknown as EdgeTx
}

interface Harness {
  driver: EdgeSqlDriver
  queue: TxWriteQueue
  changed: EdgeTxRef[][]
  errors: unknown[]
  warnings: string[]
}

async function setup(): Promise<Harness> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  const changed: EdgeTxRef[][] = []
  const errors: unknown[] = []
  const warnings: string[] = []
  const queue = makeTxWriteQueue({
    driver,
    changed: refs => changed.push(refs),
    onError: error => errors.push(error),
    warn: message => warnings.push(message),
    walletId: 'wallet'
  })
  return { driver, queue, changed, errors, warnings }
}

async function storedTxids(driver: EdgeSqlDriver): Promise<string[]> {
  const rows = await driver.query<{ txid: string }>(
    'SELECT txid FROM tx_chain ORDER BY rowid'
  )
  return rows.map(row => row.txid)
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; ++i) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for a test condition')
}

describe('transaction write queue', function () {
  afterEach(function () {
    txWriteQueueConfig.firstRetryMs = 1000
    txWriteQueueConfig.maxRetryMs = 30000
    txWriteQueueConfig.beforeSave = undefined
    txWriteQueueConfig.onRetry = undefined
  })

  it('waits a second, doubling to thirty, by default', function () {
    expect(txWriteQueueConfig.firstRetryMs).equals(1000)
    expect(txWriteQueueConfig.maxRetryMs).equals(30000)
  })

  it('resolves a push once its batch has landed, and reports it', async function () {
    const { driver, queue, changed } = await setup()
    await queue.push([makeTx('a'), makeTx('b')])
    expect(await storedTxids(driver)).deep.equals(['a', 'b'])
    expect(changed).deep.equals([
      [
        { walletId: 'wallet', txid: 'a' },
        { walletId: 'wallet', txid: 'b' }
      ]
    ])
    queue.stop()
  })

  it('reports a failed write once and retries it until it lands', async function () {
    const { driver, queue, errors } = await setup()
    txWriteQueueConfig.firstRetryMs = 1
    txWriteQueueConfig.maxRetryMs = 8
    const delays: number[] = []
    txWriteQueueConfig.onRetry = delayMs => delays.push(delayMs)
    let failures = 6
    txWriteQueueConfig.beforeSave = () => {
      if (failures-- > 0) throw new Error('Disk is full')
    }

    await queue.push([makeTx('a')])

    // Reported once, however many times it failed:
    expect(errors.length).equals(1)
    expect(String(errors[0])).includes('Disk is full')
    // Doubling, and holding at the cap:
    expect(delays).deep.equals([1, 2, 4, 8, 8, 8])
    expect(await storedTxids(driver)).deep.equals(['a'])
    queue.stop()
  })

  it('lands batches in the order they were pushed', async function () {
    const { driver, queue } = await setup()
    txWriteQueueConfig.firstRetryMs = 1
    let failures = 3
    txWriteQueueConfig.beforeSave = () => {
      if (failures-- > 0) throw new Error('Busy')
    }

    // The second batch waits behind the first, which is retrying:
    const first = queue.push([makeTx('first')])
    const second = queue.push([makeTx('second')])
    await Promise.all([first, second])
    expect(await storedTxids(driver)).deep.equals(['first', 'second'])
    queue.stop()
  })

  it('stops retrying at logout, leaving the push unsettled', async function () {
    const { driver, queue, errors, warnings } = await setup()
    txWriteQueueConfig.firstRetryMs = 5
    txWriteQueueConfig.beforeSave = () => {
      throw new Error('Never works')
    }
    let settled = false
    queue
      .push([makeTx('a'), makeTx('b')])
      .then(() => (settled = true))
      .catch(() => (settled = true))
    await waitFor(() => errors.length === 1)

    queue.stop()
    const attempts: number[] = []
    txWriteQueueConfig.onRetry = delayMs => attempts.push(delayMs)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(settled).equals(false)
    expect(attempts).deep.equals([])
    // Logged rather than reported: after logout nobody is left to tell:
    expect(errors.length).equals(1)
    expect(warnings.length).equals(1)
    expect(warnings[0]).includes('2 transactions')
    expect(await storedTxids(driver)).deep.equals([])
  })

  it('never settles a push made after stopping', async function () {
    const { queue } = await setup()
    queue.stop()
    queue.stop()
    let settled = false
    queue.push([makeTx('a')]).then(
      () => (settled = true),
      () => (settled = true)
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).equals(false)
  })

  it('gives one wallet one queue, until it stops', async function () {
    const io = {}
    let made = 0
    const make = (): TxWriteQueue => {
      ++made
      return { push: async () => {}, stop: () => {} }
    }
    const a = walletTxWriteQueue(io, 'wallet', make)
    const b = walletTxWriteQueue(io, 'wallet', make)
    expect(a).equals(b)
    expect(made).equals(1)

    // Another context has its own:
    walletTxWriteQueue({}, 'wallet', make)
    expect(made).equals(2)

    stopWalletTxWriteQueue(io, 'wallet')
    stopWalletTxWriteQueue(io, 'wallet')
    stopWalletTxWriteQueue({}, 'missing')
    walletTxWriteQueue(io, 'wallet', make)
    expect(made).equals(3)
  })
})
