import { expect } from 'chai'
import { describe, it } from 'mocha'

import { asTransactionFile } from '../../../src/core/currency/wallet/currency-wallet-cleaners'
import { changedTxidHashes } from '../../../src/core/currency/wallet/currency-wallet-files'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  clearTxMetaDirty,
  readDirtyTxMeta,
  saveSyncedTxMetas,
  saveTxMetas,
  saveTxMetasIfAbsent,
  toTxMetaDoc
} from '../../../src/core/db/meta-writer'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'

/**
 * Mirroring sync-repo metadata into `tx_meta`.
 *
 * The sync repo stays authoritative, so nothing here can lose a user's
 * annotation -- but the index triggers read these rows, so a mirror that gets
 * the shape wrong makes metadata invisible to every query.
 */

function makeFile(raw: object = {}): ReturnType<typeof asTransactionFile> {
  return asTransactionFile({
    txid: 'tx1',
    internal: false,
    creationDate: 1717200000,
    currencies: {},
    tokens: {},
    ...raw
  })
}

async function makeDb(): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  return driver
}

describe('metadata mirror', function () {
  it('spells the chain asset as an empty key', function () {
    const doc = JSON.parse(
      toTxMetaDoc(
        makeFile({ tokens: { '': { metadata: { name: 'Alice' } } } }),
        'BTC',
        { fileDirty: false }
      )
    )
    expect(doc.tokens['']).deep.includes({ metadata: { name: 'Alice' } })
  })

  it('moves legacy metadata under the chain asset', function () {
    // Airbitz files key metadata by currency code under `currencies`; modern
    // ones key it by tokenId under `tokens`. The triggers read one shape, so
    // the conversion happens here rather than in every query.
    const doc = JSON.parse(
      toTxMetaDoc(
        makeFile({ currencies: { BTC: { metadata: { name: 'Legacy' } } } }),
        'BTC',
        { fileDirty: false }
      )
    )
    expect(doc.tokens[''].metadata.name).equals('Legacy')
  })

  it('does not let legacy metadata overwrite modern metadata', function () {
    const doc = JSON.parse(
      toTxMetaDoc(
        makeFile({
          currencies: { BTC: { metadata: { name: 'Legacy' } } },
          tokens: { '': { metadata: { name: 'Modern' } } }
        }),
        'BTC',
        { fileDirty: false }
      )
    )
    expect(doc.tokens[''].metadata.name).equals('Modern')
  })

  it('indexes what the mirror wrote', async function () {
    const driver = await makeDb()
    try {
      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'tx1',
          file: makeFile({ tokens: { '': { metadata: { name: 'Alice' } } } })
        }
      ])

      expect(
        await driver.query(
          `SELECT token_id, has_meta, has_chain, has_metadata, effective_date
             FROM tx_asset_idx`
        )
      ).deep.equals([
        {
          token_id: '',
          has_meta: 1,
          has_chain: 0,
          has_metadata: 1,
          effective_date: 1717200000
        }
      ])
    } finally {
      await driver.close()
    }
  })

  it('lets a synced file replace a clean row but not a dirty one', async function () {
    const driver = await makeDb()
    try {
      const file = (name: string): ReturnType<typeof makeFile> =>
        makeFile({ tokens: { '': { metadata: { name } } } })
      await saveTxMetas(driver, 'W1', 'BTC', [
        { txid: 'clean', file: file('Old') }
      ])
      // A local edit whose file write failed -- newer than any file:
      await saveTxMetas(
        driver,
        'W1',
        'BTC',
        [{ txid: 'dirty', file: file('Local') }],
        { fileDirty: true }
      )

      await saveSyncedTxMetas(driver, 'W1', 'BTC', [
        { txid: 'clean', file: file('Synced') },
        { txid: 'dirty', file: file('Synced') },
        { txid: 'new', file: file('Synced') }
      ])
      await saveSyncedTxMetas(driver, 'W1', 'BTC', [])

      const rows = await driver.query<{ txid: string; doc: string }>(
        'SELECT txid, json(doc) AS doc FROM tx_meta ORDER BY txid'
      )
      const names = rows.map(row => [
        row.txid,
        JSON.parse(row.doc).tokens[''].metadata.name,
        JSON.parse(row.doc).fileDirty
      ])
      expect(names).deep.equals([
        ['clean', 'Synced', 0],
        ['dirty', 'Local', 1],
        ['new', 'Synced', 0]
      ])
    } finally {
      await driver.close()
    }
  })

  it('leaves any existing row when only filling gaps', async function () {
    const driver = await makeDb()
    try {
      const file = (name: string): ReturnType<typeof makeFile> =>
        makeFile({ tokens: { '': { metadata: { name } } } })
      await saveTxMetas(driver, 'W1', 'BTC', [{ txid: 'a', file: file('Row') }])
      await saveTxMetasIfAbsent(driver, 'W1', 'BTC', [
        { txid: 'a', file: file('File') },
        { txid: 'b', file: file('File') }
      ])
      await saveTxMetasIfAbsent(driver, 'W1', 'BTC', [])

      const rows = await driver.query<{ txid: string; doc: string }>(
        'SELECT txid, json(doc) AS doc FROM tx_meta ORDER BY txid'
      )
      expect(
        rows.map(row => JSON.parse(row.doc).tokens[''].metadata.name)
      ).deep.equals(['Row', 'File'])
    } finally {
      await driver.close()
    }
  })

  it('replaces rather than merging', async function () {
    const driver = await makeDb()
    try {
      // A metadata file is written whole by whoever last edited it, so it is
      // a complete statement rather than one asset's contribution. Merging
      // would make a deleted note un-deletable.
      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'tx1',
          file: makeFile({
            tokens: { '': { metadata: { name: 'Alice', notes: 'rent' } } }
          })
        }
      ])
      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'tx1',
          file: makeFile({ tokens: { '': { metadata: { name: 'Alice' } } } })
        }
      ])

      const rows = await driver.query<{ doc: string }>(
        'SELECT json(doc) AS doc FROM tx_meta'
      )
      expect(JSON.parse(rows[0].doc).tokens[''].metadata.notes).equals(
        undefined
      )
    } finally {
      await driver.close()
    }
  })

  it('tracks rows the sync repo has not caught up with', async function () {
    const driver = await makeDb()
    try {
      const write = { txid: 'tx1', file: makeFile() }
      await saveTxMetas(driver, 'W1', 'BTC', [write], { fileDirty: true })

      expect(
        (await readDirtyTxMeta(driver, 'W1')).map(row => row.txid)
      ).deep.equals(['tx1'])

      await clearTxMetaDirty(driver, 'W1', ['tx1'])
      expect(await readDirtyTxMeta(driver, 'W1')).deep.equals([])
    } finally {
      await driver.close()
    }
  })

  it('keeps clean rows out of the flusher', async function () {
    const driver = await makeDb()
    try {
      await saveTxMetas(driver, 'W1', 'BTC', [
        { txid: 'tx1', file: makeFile() }
      ])
      expect(await readDirtyTxMeta(driver, 'W1')).deep.equals([])
    } finally {
      await driver.close()
    }
  })

  it('returns a document the file cleaner can read back', async function () {
    const driver = await makeDb()
    try {
      const file = makeFile({
        tokens: { '': { metadata: { name: 'Alice' } } }
      })
      await saveTxMetas(driver, 'W1', 'BTC', [{ txid: 'tx1', file }], {
        fileDirty: true
      })

      // The flusher re-reads these to retry the file write, so the round trip
      // has to survive the database:
      const [row] = await readDirtyTxMeta(driver, 'W1')
      const back = asTransactionFile(row.doc)
      expect(back.tokens.get(null)?.metadata.name).equals('Alice')
      expect(back.creationDate).equals(1717200000)
    } finally {
      await driver.close()
    }
  })
})

describe('changed metadata files', function () {
  it('names the transactions a sync touched', function () {
    // The §3 defect: `reloadWalletFiles` reloaded file *names* and never the
    // contents, and `loadTxFiles` is only asked for files the core has no
    // copy of -- so an edit made on another device stayed invisible until the
    // core restarted. This is what now asks for them.
    expect(
      changedTxidHashes([
        'transaction/1717200000-abc123.json',
        'transaction/1717200001-def456.json'
      ])
    ).deep.equals(['abc123', 'def456'])
  })

  it('ignores everything that is not a metadata file', function () {
    expect(
      changedTxidHashes([
        'Currency.json',
        'WalletName.json',
        'transaction/',
        'transaction/nonsense.json',
        'transaction/1717200000-abc123.json.bak',
        // Legacy files are read-only history, rewritten into the modern path
        // on first load:
        'Transactions/1717200000-abc123.json'
      ])
    ).deep.equals([])
  })
})
