import { expect } from 'chai'
import { describe, it } from 'mocha'

import { asTransactionFile } from '../../../src/core/currency/wallet/currency-wallet-cleaners'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { reindexTable } from '../../../src/core/db/db-index'
import { prepareDatabase } from '../../../src/core/db/db-open'
import { saveTxMetas } from '../../../src/core/db/meta-writer'
import { queryTxPage } from '../../../src/core/db/tx-query'
import { saveTxs } from '../../../src/core/db/tx-writer'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTx } from '../../../src/types/types'

/**
 * Searching the user's own words.
 *
 * The tokenizer is `trigram`, which matches anywhere inside a word rather
 * than only at its start -- "rent" has to find "Parental leave", because that
 * is what a search box does. The cost is that a query shorter than three
 * characters cannot use the index at all.
 */

function makeTx(txid: string): EdgeTx {
  return {
    walletId: 'W1',
    txid,
    pluginId: 'bitcoin',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 800000,
    isSend: true,
    nativeAmounts: new Map([[null, '-100']]),
    networkFees: new Map([[null, '10']]),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map()
  }
}

interface Annotation {
  name?: string
  notes?: string
  category?: string
}

async function makeDb(annotations: {
  [txid: string]: Annotation
}): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)

  const txids = Object.keys(annotations)
  await saveTxs(driver, txids.map(makeTx))
  await saveTxMetas(
    driver,
    'W1',
    'BTC',
    txids.map(txid => ({
      txid,
      file: asTransactionFile({
        txid,
        internal: false,
        creationDate: 1717200000,
        currencies: {},
        tokens: { '': { metadata: annotations[txid] } }
      })
    }))
  )
  return driver
}

async function search(
  driver: EdgeSqlDriver,
  searchString: string
): Promise<string[]> {
  const page = await queryTxPage(driver, { searchString })
  return page.transactions.map(tx => tx.txid).sort((a, b) => (a < b ? -1 : 1))
}

describe('transaction search', function () {
  it('finds a word in a name', async function () {
    const driver = await makeDb({
      rent: { name: 'Landlord' },
      food: { name: 'Grocery store' }
    })
    try {
      expect(await search(driver, 'Landlord')).deep.equals(['rent'])
    } finally {
      await driver.close()
    }
  })

  it('matches inside a word, not only at the start', async function () {
    const driver = await makeDb({
      a: { name: 'Parental leave' },
      b: { name: 'Groceries' }
    })
    try {
      // A prefix-only tokenizer would return nothing here, and the search box
      // would look broken to anyone who types the middle of a word.
      expect(await search(driver, 'rent')).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })

  it('searches notes and category too', async function () {
    const driver = await makeDb({
      a: { notes: 'paid the deposit back' },
      b: { category: 'Income:Salary' }
    })
    try {
      expect(await search(driver, 'deposit')).deep.equals(['a'])
      expect(await search(driver, 'Salary')).deep.equals(['b'])
    } finally {
      await driver.close()
    }
  })

  it('ignores case', async function () {
    const driver = await makeDb({ a: { name: 'Landlord' } })
    try {
      expect(await search(driver, 'landlord')).deep.equals(['a'])
      expect(await search(driver, 'LANDLORD')).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })

  it('falls back to LIKE below three characters', async function () {
    const driver = await makeDb({
      a: { name: 'Al' },
      b: { name: 'Bob' }
    })
    try {
      // The trigram index cannot answer this at all, so a fallback that did
      // not exist would silently return nothing.
      expect(await search(driver, 'Al')).deep.equals(['a'])
      expect(await search(driver, 'o')).deep.equals(['b'])
    } finally {
      await driver.close()
    }
  })

  it('treats punctuation as text, not as query syntax', async function () {
    const driver = await makeDb({
      a: { notes: 'invoice 12-34' },
      b: { notes: 'invoice 5678' }
    })
    try {
      // Unquoted, FTS5 would read this as an expression rather than as the
      // thing the user typed.
      expect(await search(driver, '12-34')).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })

  it('takes a quote without breaking', async function () {
    const driver = await makeDb({ a: { notes: 'the "good" one' } })
    try {
      expect(await search(driver, '"good"')).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })

  it('combines with other predicates', async function () {
    const driver = await makeDb({
      a: { name: 'Landlord' },
      b: { name: 'Landlord' }
    })
    try {
      const page = await queryTxPage(driver, {
        searchString: 'Landlord',
        txids: ['a']
      })
      expect(page.transactions.map(tx => tx.txid)).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })

  it('forgets what an edit removed', async function () {
    const driver = await makeDb({ a: { name: 'Landlord' } })
    try {
      expect(await search(driver, 'Landlord')).deep.equals(['a'])

      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'a',
          file: asTransactionFile({
            txid: 'a',
            internal: false,
            creationDate: 1717200000,
            currencies: {},
            tokens: { '': { metadata: { name: 'Someone else' } } }
          })
        }
      ])

      // An FTS index that only ever gains rows would keep answering the old
      // search forever, which is the failure the delete triggers exist for.
      expect(await search(driver, 'Landlord')).deep.equals([])
      expect(await search(driver, 'Someone')).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })

  it('indexes every asset of a transaction into one row', async function () {
    const driver = makeMemorySqlDriver()
    await prepareDatabase(driver)
    try {
      await saveTxs(driver, [makeTx('swap')])
      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'swap',
          file: asTransactionFile({
            txid: 'swap',
            internal: false,
            creationDate: 1717200000,
            currencies: {},
            tokens: {
              '': { metadata: { name: 'Sold bitcoin' } },
              abc: { metadata: { name: 'Bought tether' } }
            }
          })
        }
      ])

      // A search returns transactions, and someone who labelled one side of a
      // swap expects to find the swap:
      expect(await search(driver, 'bitcoin')).deep.equals(['swap'])
      expect(await search(driver, 'tether')).deep.equals(['swap'])
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_search_idx')
      ).deep.equals([{ n: 1 }])
    } finally {
      await driver.close()
    }
  })

  it('stores nothing for a transaction with no words', async function () {
    const driver = await makeDb({ a: {} })
    try {
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_search_idx')
      ).deep.equals([{ n: 0 }])
    } finally {
      await driver.close()
    }
  })

  it('rebuilds to the same rows', async function () {
    const driver = await makeDb({
      a: { name: 'Landlord', notes: 'rent' },
      b: { category: 'Income:Salary' }
    })
    try {
      const before = await driver.query(
        'SELECT * FROM tx_search_idx ORDER BY wallet_id, txid'
      )

      await reindexTable(driver, 'tx_search_idx')

      expect(
        await driver.query(
          'SELECT * FROM tx_search_idx ORDER BY wallet_id, txid'
        )
      ).deep.equals(before)
      // And the FTS index came back with it, through the same triggers that
      // maintain it in normal use:
      expect(await search(driver, 'Landlord')).deep.equals(['a'])
    } finally {
      await driver.close()
    }
  })
})
