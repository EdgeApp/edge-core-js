import { expect } from 'chai'
import { describe, it } from 'mocha'

import { schemaStatements } from '../../../src/core/db/db-schema'
import { makeMemorySqlSync } from '../../../src/io/node/node-sql-driver'

/**
 * The schema and its trigger fan-out.
 *
 * `tx_asset_idx` is what every account-wide query is answered from, and it is
 * maintained entirely by trigger. Nothing else notices when it goes wrong: a
 * missing row is a transaction that has silently vanished from the list, and a
 * stale one is a transaction whose amount or date no longer matches its own
 * document.
 */

type Db = ReturnType<typeof makeMemorySqlSync>

interface AssetRow {
  token_id: string
  has_chain: number
  has_meta: number
  effective_date: number
  plugin_id: string | null
  block_height: number | null
  is_send: number | null
  native_amount_key: string | null
  network_fee_key: string | null
  has_metadata: number
}

function makeDb(): Db {
  const db = makeMemorySqlSync()
  for (const sql of schemaStatements) db.exec(sql)
  return db
}

interface ChainDoc {
  pluginId?: string
  date?: string
  blockHeight?: number
  isSend?: boolean
  nativeAmounts?: { [tokenKey: string]: string }
  networkFees?: { [tokenKey: string]: string }
}

function putChain(db: Db, walletId: string, txid: string, doc: ChainDoc): void {
  db.run(
    'INSERT OR REPLACE INTO tx_chain (wallet_id, txid, doc) VALUES (?, ?, jsonb(?))',
    walletId,
    txid,
    JSON.stringify({
      walletId,
      txid,
      pluginId: 'bitcoin',
      date: '2024-06-01T12:00:00.000Z',
      blockHeight: 800000,
      isSend: true,
      nativeAmounts: {},
      networkFees: {},
      ...doc
    })
  )
}

function putMeta(db: Db, walletId: string, txid: string, doc: object): void {
  db.run(
    'INSERT OR REPLACE INTO tx_meta (wallet_id, txid, doc) VALUES (?, ?, jsonb(?))',
    walletId,
    txid,
    JSON.stringify({ txid, creationDate: 1717200000, tokens: {}, ...doc })
  )
}

function assets(db: Db, walletId = 'W1', txid = 'tx1'): AssetRow[] {
  return db.all<AssetRow>(
    `SELECT token_id, has_chain, has_meta, effective_date, plugin_id,
            block_height, is_send, native_amount_key, network_fee_key,
            has_metadata
       FROM tx_asset_idx
      WHERE wallet_id = '${walletId}' AND txid = '${txid}'
      ORDER BY token_id`
  )
}

describe('transaction schema', function () {
  it('reads the generated columns out of the document', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })

      expect(
        db.all(`SELECT plugin_id, date, block_height, is_send FROM tx_chain`)
      ).deep.equals([
        {
          plugin_id: 'bitcoin',
          date: 1717243200, // 2024-06-01T12:00:00Z
          block_height: 800000,
          is_send: 1
        }
      ])
    } finally {
      db.close()
    }
  })

  it('makes one asset row per asset the transaction touches', function () {
    const db = makeDb()
    try {
      // A token transfer: the token moves, and the fee is paid in the chain's
      // own asset. Neither asset has both an amount and a fee.
      putChain(db, 'W1', 'tx1', {
        nativeAmounts: { abc: '50000000' },
        networkFees: { '': '2100' }
      })

      const rows = assets(db)
      expect(rows.length).equals(2)

      expect(rows[0].token_id).equals('')
      expect(rows[0].native_amount_key).equals(null)
      expect(rows[0].network_fee_key).does.not.equal(null)

      expect(rows[1].token_id).equals('abc')
      expect(rows[1].native_amount_key).does.not.equal(null)
      expect(rows[1].network_fee_key).equals(null)
    } finally {
      db.close()
    }
  })

  it('copies the chain columns onto every asset row', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'tx1', {
        nativeAmounts: { '': '-100', abc: '50' }
      })

      for (const row of assets(db)) {
        expect(row.has_chain).equals(1)
        expect(row.has_meta).equals(0)
        expect(row.plugin_id).equals('bitcoin')
        expect(row.block_height).equals(800000)
        expect(row.is_send).equals(1)
        expect(row.effective_date).equals(1717243200)
      }
    } finally {
      db.close()
    }
  })

  it('orders amounts the way the numbers order', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'a', { nativeAmounts: { '': '9' } })
      putChain(db, 'W1', 'b', { nativeAmounts: { '': '10' } })
      putChain(db, 'W1', 'c', { nativeAmounts: { '': '-100' } })

      expect(
        db
          .all<{ txid: string }>(
            'SELECT txid FROM tx_asset_idx ORDER BY native_amount_key'
          )
          .map(row => row.txid)
      ).deep.equals(['c', 'a', 'b'])
    } finally {
      db.close()
    }
  })

  it('takes the earlier of the chain date and the metadata date', function () {
    const db = makeDb()
    try {
      // Metadata is written when the user first sees a transaction, which can
      // be before the chain date settles -- so the list uses whichever came
      // first, or the transaction would jump around.
      putMeta(db, 'W1', 'tx1', { creationDate: 1000 })
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })

      expect(assets(db)[0].effective_date).equals(1000)
    } finally {
      db.close()
    }
  })

  it('indexes metadata that arrived before the chain data', function () {
    const db = makeDb()
    try {
      // An orphan: the user annotated a transaction this device has not seen
      // yet. The row exists so the annotation is not lost, and carries no
      // chain columns.
      putMeta(db, 'W1', 'tx1', {
        creationDate: 1717200000,
        tokens: { '': { metadata: { name: 'Alice' } } }
      })

      const rows = assets(db)
      expect(rows.length).equals(1)
      expect(rows[0].has_chain).equals(0)
      expect(rows[0].has_meta).equals(1)
      expect(rows[0].has_metadata).equals(1)
      expect(rows[0].plugin_id).equals(null)
      expect(rows[0].effective_date).equals(1717200000)
    } finally {
      db.close()
    }
  })

  it('marks empty metadata as empty', function () {
    const db = makeDb()
    try {
      // `EdgeMetadata` with nothing in it is what the core writes when it
      // creates a file for its own reasons. Treating that as an annotation
      // would make the "has metadata" filter useless.
      putMeta(db, 'W1', 'tx1', {
        tokens: { '': { metadata: {} } }
      })
      expect(assets(db)[0].has_metadata).equals(0)
    } finally {
      db.close()
    }
  })

  it('drops asset rows an update removed', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'tx1', {
        nativeAmounts: { '': '-100', abc: '50' }
      })
      expect(assets(db).length).equals(2)

      // A resync can correct a transaction to touch fewer assets. A row left
      // behind would show a balance change that no longer exists.
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })
      expect(assets(db).map(row => row.token_id)).deep.equals([''])
    } finally {
      db.close()
    }
  })

  it('keeps the metadata row when the chain row is deleted', function () {
    const db = makeDb()
    try {
      putMeta(db, 'W1', 'tx1', {
        tokens: { '': { metadata: { name: 'Alice' } } }
      })
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })
      expect(assets(db)[0].has_chain).equals(1)

      // A dropped transaction loses its chain data, but the user's annotation
      // is theirs and survives:
      db.run(`DELETE FROM tx_chain WHERE wallet_id = 'W1' AND txid = 'tx1'`)
      const rows = assets(db)
      expect(rows.length).equals(1)
      expect(rows[0].has_chain).equals(0)
      expect(rows[0].has_meta).equals(1)
    } finally {
      db.close()
    }
  })

  it('removes every asset row when both documents are gone', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })
      putMeta(db, 'W1', 'tx1', {})
      db.run(`DELETE FROM tx_chain WHERE wallet_id = 'W1'`)
      db.run(`DELETE FROM tx_meta WHERE wallet_id = 'W1'`)
      expect(assets(db)).deep.equals([])
    } finally {
      db.close()
    }
  })

  it('keeps wallets apart', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })
      putChain(db, 'W2', 'tx1', { nativeAmounts: { '': '-200' } })

      // The same txid in two wallets is ordinary -- a split wallet sees both.
      expect(assets(db, 'W1').length).equals(1)
      expect(assets(db, 'W2').length).equals(1)
      db.run(`DELETE FROM tx_chain WHERE wallet_id = 'W1'`)
      expect(assets(db, 'W1').length).equals(0)
      expect(assets(db, 'W2').length).equals(1)
    } finally {
      db.close()
    }
  })

  it('answers each page shape from its own index', function () {
    const db = makeDb()
    try {
      // The three indexes overlap, and the reason they are not redundant is
      // that each puts a different column first. This is where that claim is
      // either true or not: a plan naming the wrong index, or adding a
      // "USE TEMP B-TREE FOR ORDER BY", means the query it serves has started
      // scanning and sorting.
      const plan = (sql: string): string =>
        db
          .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
          .map(row => row.detail)
          .join(' | ')

      expect(
        plan(`SELECT * FROM tx_asset_idx
               ORDER BY effective_date DESC, txid DESC, token_id DESC
               LIMIT 20`)
      ).equals('SCAN tx_asset_idx USING INDEX tx_asset_date_idx')

      expect(
        plan(`SELECT * FROM tx_asset_idx WHERE wallet_id = 'W1'
               ORDER BY effective_date DESC, txid DESC, token_id DESC
               LIMIT 20`)
      ).equals(
        'SEARCH tx_asset_idx USING INDEX tx_asset_wallet_date_idx (wallet_id=?)'
      )

      expect(
        plan(`SELECT * FROM tx_asset_idx WHERE token_id = 'abc'
               ORDER BY effective_date DESC, txid DESC
               LIMIT 20`)
      ).equals(
        'SEARCH tx_asset_idx USING INDEX tx_asset_token_date_idx (token_id=?)'
      )

      expect(
        plan(`SELECT * FROM tx_asset_idx
               WHERE wallet_id = 'W1' AND txid = 'tx1'`)
      ).includes('SEARCH tx_asset_idx USING INDEX sqlite_autoindex')
    } finally {
      db.close()
    }
  })

  it('leaves fiat amounts empty', function () {
    const db = makeDb()
    try {
      putChain(db, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })
      // The column exists from the start, so the schema does not churn when
      // the rate work lands. Nothing fills it until then.
      expect(
        db.all('SELECT fiat_amount, fiat_is_user FROM tx_asset_idx')
      ).deep.equals([{ fiat_amount: null, fiat_is_user: 0 }])
    } finally {
      db.close()
    }
  })
})
