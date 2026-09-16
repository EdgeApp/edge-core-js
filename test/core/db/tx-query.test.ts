import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  queryTxPage,
  readTx,
  streamTxPages
} from '../../../src/core/db/tx-query'
import { saveTxs } from '../../../src/core/db/tx-writer'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeAccountTxQuery, EdgeTx } from '../../../src/types/types'
import { expectRejection } from '../../expect-rejection'

/**
 * The account-wide query.
 *
 * Every query is answered from `tx_asset_idx`, whose grain is one row per
 * (wallet, transaction, asset), and callers want transactions -- so the
 * interesting cases are the ones where those two differ.
 */

function makeTx(overrides: Partial<EdgeTx> = {}): EdgeTx {
  return {
    walletId: 'W1',
    txid: 'tx1',
    pluginId: 'bitcoin',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 800000,
    isSend: true,
    nativeAmounts: new Map([[null, '-100']]),
    networkFees: new Map([[null, '10']]),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map(),
    ...overrides
  }
}

/** `n` transactions, one per day, newest last. */
function makeSeries(count: number, overrides: Partial<EdgeTx> = {}): EdgeTx[] {
  const out: EdgeTx[] = []
  for (let i = 0; i < count; ++i) {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString()
    out.push(
      makeTx({ txid: `tx${String(i).padStart(3, '0')}`, date, ...overrides })
    )
  }
  return out
}

async function makeDb(txs: EdgeTx[] = []): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  if (txs.length > 0) await saveTxs(driver, txs)
  return driver
}

async function txids(
  driver: EdgeSqlDriver,
  query: EdgeAccountTxQuery
): Promise<string[]> {
  const page = await queryTxPage(driver, query)
  return page.transactions.map(tx => tx.txid)
}

describe('account transaction query', function () {
  it('returns transactions newest first', async function () {
    const driver = await makeDb(makeSeries(3))
    try {
      expect(await txids(driver, {})).deep.equals(['tx002', 'tx001', 'tx000'])
    } finally {
      await driver.close()
    }
  })

  it('returns one transaction per transaction, not per asset', async function () {
    const driver = await makeDb([
      makeTx({
        txid: 'swap',
        nativeAmounts: new Map([['abc', '50000000']]),
        networkFees: new Map([[null, '21000']])
      })
    ])
    try {
      // Two index rows, one transaction. This is the shape the project
      // exists to retire: a caller reads the asset out of `nativeAmounts`
      // rather than receiving the same transaction twice.
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_asset_idx')
      ).deep.equals([{ n: 2 }])

      const page = await queryTxPage(driver, {})
      expect(page.transactions.length).equals(1)
      expect(page.transactions[0].nativeAmounts.get('abc')).equals('50000000')
      expect(page.transactions[0].networkFees.get(null)).equals('21000')
    } finally {
      await driver.close()
    }
  })

  it('pages by cursor without skipping or repeating', async function () {
    const driver = await makeDb(makeSeries(10))
    try {
      const seen: string[] = []
      let after: string | undefined
      for (let i = 0; i < 20; ++i) {
        const page = await queryTxPage(driver, { limit: 3, after })
        seen.push(...page.transactions.map(tx => tx.txid))
        if (page.cursor == null) break
        after = page.cursor
      }

      expect(seen).deep.equals(
        makeSeries(10)
          .map(tx => tx.txid)
          .reverse()
      )
    } finally {
      await driver.close()
    }
  })

  it('does not skip a row when one arrives mid-scroll', async function () {
    const driver = await makeDb(makeSeries(6))
    try {
      // The reason this pages by cursor and not by offset: an offset shifts
      // under an insert, so the reader would skip a transaction.
      const first = await queryTxPage(driver, { limit: 3 })
      expect(first.transactions.map(tx => tx.txid)).deep.equals([
        'tx005',
        'tx004',
        'tx003'
      ])

      await saveTxs(driver, [
        makeTx({ txid: 'newest', date: '2030-01-01T00:00:00.000Z' })
      ])

      const second = await queryTxPage(driver, {
        limit: 3,
        after: first.cursor
      })
      expect(second.transactions.map(tx => tx.txid)).deep.equals([
        'tx002',
        'tx001',
        'tx000'
      ])
    } finally {
      await driver.close()
    }
  })

  it('rejects a cursor from a different sort', async function () {
    const driver = await makeDb(makeSeries(5))
    try {
      const page = await queryTxPage(driver, { limit: 2 })
      await expectRejection(
        queryTxPage(driver, {
          limit: 2,
          after: page.cursor,
          sort: { field: 'nativeAmount', direction: 'desc' }
        })
      )
    } finally {
      await driver.close()
    }
  })

  it('rejects a cursor that is not one of ours', async function () {
    const driver = await makeDb(makeSeries(2))
    try {
      await expectRejection(queryTxPage(driver, { after: 'not-a-cursor' }))
    } finally {
      await driver.close()
    }
  })

  it('scopes by wallet, plugin and asset', async function () {
    const driver = await makeDb([
      makeTx({ walletId: 'W1', txid: 'btc', pluginId: 'bitcoin' }),
      makeTx({ walletId: 'W2', txid: 'eth', pluginId: 'ethereum' }),
      makeTx({
        walletId: 'W2',
        txid: 'token',
        pluginId: 'ethereum',
        nativeAmounts: new Map([['abc', '5']])
      })
    ])
    try {
      expect(await txids(driver, { walletIds: ['W1'] })).deep.equals(['btc'])
      expect(
        new Set(await txids(driver, { pluginIds: ['ethereum'] }))
      ).deep.equals(new Set(['eth', 'token']))
      expect(await txids(driver, { tokenIds: ['abc'] })).deep.equals(['token'])
      expect(
        await txids(driver, {
          assets: [{ pluginId: 'ethereum', tokenId: 'abc' }]
        })
      ).deep.equals(['token'])
    } finally {
      await driver.close()
    }
  })

  it('treats an empty scope as matching nothing', async function () {
    const driver = await makeDb(makeSeries(3))
    try {
      // Not the same as no scope at all: a caller filtering to a set that
      // turned out empty means "none of these", not "all of them".
      expect(await txids(driver, { walletIds: [] })).deep.equals([])
    } finally {
      await driver.close()
    }
  })

  it('filters by direction and date', async function () {
    const driver = await makeDb([
      makeTx({ txid: 'sent', isSend: true, date: '2024-01-01T00:00:00.000Z' }),
      makeTx({
        txid: 'received',
        isSend: false,
        date: '2024-06-01T00:00:00.000Z'
      })
    ])
    try {
      expect(await txids(driver, { direction: 'send' })).deep.equals(['sent'])
      expect(await txids(driver, { direction: 'receive' })).deep.equals([
        'received'
      ])
      expect(
        await txids(driver, { afterDate: new Date('2024-03-01T00:00:00Z') })
      ).deep.equals(['received'])
      expect(
        await txids(driver, { beforeDate: new Date('2024-03-01T00:00:00Z') })
      ).deep.equals(['sent'])
    } finally {
      await driver.close()
    }
  })

  it('compares amounts as numbers, not as text', async function () {
    const driver = await makeDb([
      makeTx({ txid: 'small', nativeAmounts: new Map([[null, '9']]) }),
      makeTx({ txid: 'large', nativeAmounts: new Map([[null, '10']]) }),
      makeTx({ txid: 'huge', nativeAmounts: new Map([[null, '1000000']]) })
    ])
    try {
      // Lexically "9" sorts above "10", so a text comparison would answer
      // this wrongly and look right on small numbers.
      expect(
        new Set(await txids(driver, { minNativeAmount: '10' }))
      ).deep.equals(new Set(['huge', 'large']))
      expect(await txids(driver, { maxNativeAmount: '9' })).deep.equals([
        'small'
      ])
    } finally {
      await driver.close()
    }
  })

  it('filters by network fee independently of amount', async function () {
    const driver = await makeDb([
      makeTx({
        txid: 'cheap',
        nativeAmounts: new Map([[null, '-100']]),
        networkFees: new Map([[null, '10']])
      }),
      makeTx({
        txid: 'dear',
        nativeAmounts: new Map([[null, '-100']]),
        networkFees: new Map([[null, '9000']])
      })
    ])
    try {
      expect(await txids(driver, { minNetworkFee: '1000' })).deep.equals([
        'dear'
      ])
    } finally {
      await driver.close()
    }
  })

  it('hides orphans unless asked', async function () {
    const driver = await makeDb(makeSeries(1))
    try {
      await driver.exec([
        {
          sql: `INSERT INTO tx_meta (wallet_id, txid, doc)
                VALUES ('W1', 'ghost', jsonb(?))`,
          params: [
            JSON.stringify({
              txid: 'ghost',
              creationDate: 1700000000,
              tokens: { '': { metadata: { name: 'Annotated elsewhere' } } }
            })
          ]
        }
      ])

      // An orphan has no amounts, so showing one looks like a transaction
      // that lost them:
      expect(await txids(driver, {})).deep.equals(['tx000'])
      expect(
        (
          await queryTxPage(driver, {
            includeOrphans: true,
            details: 'summary'
          })
        ).summary?.count
      ).equals(2)
    } finally {
      await driver.close()
    }
  })

  it('summarizes without returning transactions', async function () {
    const driver = await makeDb(makeSeries(5))
    try {
      const page = await queryTxPage(driver, { details: 'summary' })
      expect(page.transactions).deep.equals([])
      expect(page.summary?.count).equals(5)
      expect(page.summary?.earliestDate?.toISOString()).equals(
        '2024-01-01T00:00:00.000Z'
      )
      expect(page.summary?.latestDate?.toISOString()).equals(
        '2024-01-05T00:00:00.000Z'
      )
    } finally {
      await driver.close()
    }
  })

  it('answers a page and a summary in one call', async function () {
    const driver = await makeDb(makeSeries(5))
    try {
      // The point of `details`: counts and a page answer the same predicate,
      // so asking for both should not cost two bridge round trips.
      const page = await queryTxPage(driver, { details: 'all', limit: 2 })
      expect(page.transactions.length).equals(2)
      expect(page.summary?.count).equals(5)
    } finally {
      await driver.close()
    }
  })

  it('counts transactions rather than index rows', async function () {
    const driver = await makeDb([
      makeTx({
        txid: 'swap',
        nativeAmounts: new Map([['abc', '5']]),
        networkFees: new Map([[null, '21000']])
      })
    ])
    try {
      expect(
        (await queryTxPage(driver, { details: 'summary' })).summary?.count
      ).equals(1)
    } finally {
      await driver.close()
    }
  })

  it('sorts by amount within a bounded query', async function () {
    const driver = await makeDb([
      makeTx({ txid: 'mid', nativeAmounts: new Map([[null, '10']]) }),
      makeTx({ txid: 'low', nativeAmounts: new Map([[null, '-100']]) }),
      makeTx({ txid: 'high', nativeAmounts: new Map([[null, '1000000']]) })
    ])
    try {
      expect(
        await txids(driver, {
          walletIds: ['W1'],
          sort: { field: 'nativeAmount', direction: 'asc' }
        })
      ).deep.equals(['low', 'mid', 'high'])
    } finally {
      await driver.close()
    }
  })

  it('refuses to sort the whole account by amount', async function () {
    const driver = await makeDb(makeSeries(3))
    try {
      // The three indexes lead with a date, a wallet or an asset, so nothing
      // orders the whole account by amount without reading all of it. Sorting
      // a *bounded* set is fine, which is the test above. Serving this one
      // means adding an index for it, deliberately.
      await expectRejection(
        queryTxPage(driver, {
          sort: { field: 'nativeAmount', direction: 'desc' }
        })
      )
    } finally {
      await driver.close()
    }
  })

  it('reads one transaction by identity', async function () {
    const driver = await makeDb([
      makeTx({ walletId: 'W1', txid: 'shared' }),
      makeTx({ walletId: 'W2', txid: 'shared', blockHeight: 42 })
    ])
    try {
      // The same txid in two wallets is ordinary -- a split wallet sees both.
      expect((await readTx(driver, 'W2', 'shared'))?.blockHeight).equals(42)
      expect(await readTx(driver, 'W3', 'shared')).equals(undefined)
    } finally {
      await driver.close()
    }
  })

  it('streams every page', async function () {
    const driver = await makeDb(makeSeries(7))
    try {
      const seen: string[] = []
      for await (const batch of streamTxPages(driver, { limit: 2 })) {
        seen.push(...batch.map(tx => tx.txid))
      }
      expect(seen.length).equals(7)
    } finally {
      await driver.close()
    }
  })

  it('names the plan when it refuses a query', async function () {
    const driver = await makeDb(makeSeries(3))
    try {
      // The guard reads the query plan rather than checking a list of allowed
      // fields, so it holds for whatever the builder grows into. The message
      // has to say what to do about it.
      let message = ''
      try {
        await queryTxPage(driver, {
          sort: { field: 'blockHeight', direction: 'desc' }
        })
      } catch (error) {
        message = String(error)
      }
      expect(message).includes('cannot use an index')
      expect(message).includes('SCAN')
    } finally {
      await driver.close()
    }
  })

  it('caps the page size', async function () {
    const driver = await makeDb(makeSeries(3))
    try {
      // A caller asking for everything gets a page, not the account.
      const page = await queryTxPage(driver, { limit: 100000 })
      expect(page.transactions.length).equals(3)
    } finally {
      await driver.close()
    }
  })
})
