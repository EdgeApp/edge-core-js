import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import { saveTokens } from '../../../src/core/db/fiat-materialize'
import {
  defineTables,
  ensureWalletPrefix
} from '../../../src/core/db/plugin-tables'
import {
  hasWalletCache,
  readAccountSeed,
  readWalletSeeds,
  removeCustomToken,
  resolveWalletPrefixes,
  saveAccountSettings,
  saveCustomTokens,
  saveWalletAddresses,
  saveWalletBalances,
  saveWalletRows,
  upsertWalletRow,
  WalletCacheRow
} from '../../../src/core/db/wallet-store'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeToken } from '../../../src/types/types'

/**
 * The account's boot state, as rows.
 *
 * Most of this is round trips, because the rows replace a JSON file whose
 * whole job was to hand the account back what it wrote. The rest is about the
 * two writers a wallet row has, and what each must leave alone.
 */

function walletId(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64')
}

/** The error a promise rejects with, failing if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('Expecting this promise to reject')
    },
    (error: unknown) => error
  )
}

async function makeDb(): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  return driver
}

async function withDb(
  f: (driver: EdgeSqlDriver) => Promise<void>
): Promise<void> {
  const driver = await makeDb()
  try {
    await f(driver)
  } finally {
    await driver.close()
  }
}

function makeRow(
  id: string,
  opts: Partial<WalletCacheRow> = {}
): WalletCacheRow {
  return {
    walletId: id,
    pluginId: 'bitcoin',
    walletInfo: {
      id,
      type: 'wallet:bitcoin',
      keys: { publicKey: `xpub-${id.slice(0, 4)}` }
    },
    name: 'Savings',
    fiatCurrencyCode: 'iso:EUR',
    enabledTokenIds: ['tokenA', 'tokenB'],
    otherMethodNames: ['getCustomFee', 'signMessage'],
    ...opts
  }
}

const customToken: EdgeToken = {
  currencyCode: 'CUSTOM',
  displayName: 'My Token',
  denominations: [{ name: 'CUSTOM', multiplier: '1000000' }],
  networkLocation: { contractAddress: '0xabc' }
}

describe('wallet store', function () {
  it('round-trips a wallet', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      const unlockDate = new Date('2027-01-02T03:04:05.000Z')
      await saveWalletRows(driver, [
        makeRow(id, {
          stakingStatus: {
            stakedAmounts: [
              { nativeAmount: '500', unlockDate, otherParams: { pool: 'x' } }
            ]
          }
        })
      ])

      const seeds = await readWalletSeeds(driver)
      expect(Object.keys(seeds)).deep.equals([id])
      const seed = seeds[id]
      expect(seed.name).equals('Savings')
      expect(seed.fiatCurrencyCode).equals('iso:EUR')
      expect(seed.enabledTokenIds).deep.equals(['tokenA', 'tokenB'])
      expect(seed.otherMethodNames).deep.equals(['getCustomFee', 'signMessage'])
      expect(seed.publicWalletInfo).deep.equals({
        id,
        type: 'wallet:bitcoin',
        keys: { publicKey: `xpub-${id.slice(0, 4)}` }
      })
      expect(seed.stakingStatus?.stakedAmounts[0].unlockDate).deep.equals(
        unlockDate
      )
      expect(seed.stakingStatus?.stakedAmounts[0].otherParams).deep.equals({
        pool: 'x'
      })
    })
  })

  it('leaves a null name and a missing staking status as they were', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id, { name: null })])
      const seed = (await readWalletSeeds(driver))[id]
      expect(seed.name).equals(null)
      expect('stakingStatus' in seed).equals(false)
    })
  })

  it('round-trips every wallet state field', async function () {
    await withDb(async driver => {
      const full = walletId(1)
      const sparse = walletId(2)
      await upsertWalletRow(driver, full, {
        walletState: {
          archived: true,
          deleted: false,
          hidden: true,
          sortIndex: 7,
          migratedFromWalletId: walletId(9)
        }
      })
      await upsertWalletRow(driver, sparse, { walletState: { archived: true } })

      const { walletStates } = await readAccountSeed(driver)
      expect(walletStates[full]).deep.equals({
        archived: true,
        deleted: false,
        hidden: true,
        sortIndex: 7,
        migratedFromWalletId: walletId(9)
      })

      // Missing stays missing -- absent, not present-and-undefined. The
      // account spreads a state over defaults that include a sortIndex, so
      // even an undefined one would erase the default and reorder the list:
      const state = walletStates[sparse]
      expect(state).deep.equals({ archived: true })
      expect(Object.keys(state)).deep.equals(['archived'])
      expect({ sortIndex: 5, ...state }.sortIndex).equals(5)
    })
  })

  it('has no state for a wallet the account has none for', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])

      const rows = await driver.query<{ wallet_state: string | null }>(
        'SELECT wallet_state FROM wallet WHERE wallet_id = ?',
        [id]
      )
      expect(rows).deep.equals([{ wallet_state: null }])
      expect((await readAccountSeed(driver)).walletStates).deep.equals({})
    })
  })

  it("spells the chain's own asset '' in a row and null in the API", async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      await saveWalletBalances(
        driver,
        id,
        new Map([
          [null, '1000'],
          ['tokenA', '25']
        ])
      )
      await saveWalletAddresses(driver, id, '', [
        { addressType: 'publicAddress', publicAddress: 'addr-0' }
      ])

      const balanceRows = await driver.query<{ token_id: string }>(
        'SELECT token_id FROM wallet_balance ORDER BY token_id'
      )
      expect(balanceRows.map(row => row.token_id)).deep.equals(['', 'tokenA'])
      const addressRows = await driver.query<{ token_id: string }>(
        'SELECT token_id FROM wallet_address'
      )
      expect(addressRows.map(row => row.token_id)).deep.equals([''])

      const seed = (await readWalletSeeds(driver))[id]
      expect(seed.balanceMap.get(null)).equals('1000')
      expect(seed.balanceMap.get('tokenA')).equals('25')
      expect(seed.addresses['']).deep.equals([
        { addressType: 'publicAddress', publicAddress: 'addr-0' }
      ])
    })
  })

  it('seeds a wallet with no balance rows with an empty balance map', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      const seed = (await readWalletSeeds(driver))[id]
      expect(seed.balanceMap).instanceOf(Map)
      expect(seed.balanceMap.size).equals(0)
      expect(seed.addresses).deep.equals({})
    })
  })

  it('keeps two wallets of one plugin apart', async function () {
    await withDb(async driver => {
      const a = walletId(1)
      const b = walletId(2)
      await saveWalletRows(driver, [makeRow(a), makeRow(b)])
      await saveWalletBalances(driver, a, new Map([[null, '1']]))
      await saveWalletBalances(driver, b, new Map([[null, '2']]))

      const seeds = await readWalletSeeds(driver)
      expect(seeds[a].balanceMap.get(null)).equals('1')
      expect(seeds[b].balanceMap.get(null)).equals('2')
    })
  })

  it('writes one row for one balance change', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      await saveWalletBalances(
        driver,
        id,
        new Map([
          [null, '1'],
          ['tokenA', '2'],
          ['tokenB', '3']
        ])
      )
      const before = await driver.query<{
        rowid: number
        token_id: string
        native_amount: string
      }>(
        'SELECT rowid, token_id, native_amount FROM wallet_balance ORDER BY token_id'
      )

      await saveWalletBalances(driver, id, new Map([['tokenA', '20']]))

      const after = await driver.query<{
        rowid: number
        token_id: string
        native_amount: string
      }>(
        'SELECT rowid, token_id, native_amount FROM wallet_balance ORDER BY token_id'
      )
      // The other rows are the same rows, not rewritten copies:
      expect(after[0]).deep.equals(before[0])
      expect(after[2]).deep.equals(before[2])
      expect(after[1]).deep.equals({ ...before[1], native_amount: '20' })
    })
  })

  it('deletes a balance written as null', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      await saveWalletBalances(
        driver,
        id,
        new Map([
          [null, '1'],
          ['tokenA', '2']
        ])
      )
      await saveWalletBalances(driver, id, new Map([['tokenA', null]]))

      const seed = (await readWalletSeeds(driver))[id]
      expect([...seed.balanceMap.keys()]).deep.equals([null])
    })
  })

  it('keeps address order, segwit first when that is where it was', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      const addresses = [
        { addressType: 'segwitAddress', publicAddress: 'bc1q' },
        { addressType: 'publicAddress', publicAddress: '1abc' },
        { addressType: 'legacyAddress', publicAddress: '1old' }
      ]
      await saveWalletAddresses(driver, id, '', addresses)

      expect((await readWalletSeeds(driver))[id].addresses['']).deep.equals(
        addresses
      )
    })
  })

  it('drops the rows a shorter address list no longer has', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      await saveWalletAddresses(driver, id, '', [
        { addressType: 'segwitAddress', publicAddress: 'bc1q' },
        { addressType: 'publicAddress', publicAddress: '1abc' }
      ])
      await saveWalletAddresses(driver, id, '', [
        { addressType: 'publicAddress', publicAddress: '1new' }
      ])

      const count = await driver.query<{ n: number }>(
        'SELECT count(*) AS n FROM wallet_address'
      )
      expect(count).deep.equals([{ n: 1 }])
      expect((await readWalletSeeds(driver))[id].addresses['']).deep.equals([
        { addressType: 'publicAddress', publicAddress: '1new' }
      ])

      await saveWalletAddresses(driver, id, '', null)
      expect((await readWalletSeeds(driver))[id].addresses).deep.equals({})
    })
  })

  it('keeps two addresses of one type', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      const addresses = [
        { addressType: 'publicAddress', publicAddress: 'first' },
        { addressType: 'publicAddress', publicAddress: 'second' }
      ]
      await saveWalletAddresses(driver, id, '', addresses)
      expect((await readWalletSeeds(driver))[id].addresses['']).deep.equals(
        addresses
      )
    })
  })

  it('seeds nothing from a row plugin tables made, until it is cached', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await ensureWalletPrefix(driver, id, 'bitcoin')

      const rows = await driver.query<{ cached: number }>(
        'SELECT cached FROM wallet'
      )
      expect(rows).deep.equals([{ cached: 0 }])
      expect(await readWalletSeeds(driver)).deep.equals({})

      await saveWalletRows(driver, [makeRow(id)])
      expect(
        await driver.query<{ cached: number }>('SELECT cached FROM wallet')
      ).deep.equals([{ cached: 1 }])
      expect(Object.keys(await readWalletSeeds(driver))).deep.equals([id])
    })
  })

  it('keeps a state for a type no plugin claims', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await upsertWalletRow(driver, id, {
        pluginId: null,
        walletState: { archived: true, sortIndex: 3 }
      })

      expect(
        await driver.query(
          'SELECT plugin_id, cached FROM wallet WHERE wallet_id = ?',
          [id]
        )
      ).deep.equals([{ plugin_id: null, cached: 0 }])
      expect((await readAccountSeed(driver)).walletStates[id]).deep.equals({
        archived: true,
        sortIndex: 3
      })
    })
  })

  it('gives a new row a prefix unique against the ones there', async function () {
    await withDb(async driver => {
      const existing = walletId(1)
      const prefix = await ensureWalletPrefix(driver, existing, 'bitcoin')

      // A different wallet whose id shares the first bytes, so the default
      // eight characters would clash:
      const clashing = Buffer.alloc(32, 1)
      clashing[31] = 2
      const clashingId = clashing.toString('base64')
      await saveWalletRows(driver, [makeRow(clashingId)])

      const rows = await driver.query<{ wallet_id: string; prefix: string }>(
        'SELECT wallet_id, prefix FROM wallet'
      )
      const prefixes = rows.map(row => row.prefix)
      expect(new Set(prefixes).size).equals(2)
      expect(prefixes).to.include(prefix)
    })
  })

  it('allocates distinct prefixes for new rows in one batch', async function () {
    await withDb(async driver => {
      const a = Buffer.alloc(32, 1)
      const b = Buffer.alloc(32, 1)
      b[31] = 2
      const prefixes = await resolveWalletPrefixes(driver, [
        a.toString('base64'),
        b.toString('base64')
      ])
      expect(new Set(prefixes.values()).size).equals(2)
    })
  })

  it('lets each writer of a row leave the other its columns', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])
      await upsertWalletRow(driver, id, { walletState: { sortIndex: 4 } })

      // Every engine start redefines its tables:
      await defineTables(driver, {
        walletId: id,
        pluginId: 'bitcoin',
        spec: { version: 5, tables: { utxo: { key: ['id'] } } }
      })

      const afterDefine = await driver.query<{
        cached: number
        name: string
        wallet_state: string
        table_version: number
      }>(
        'SELECT cached, name, wallet_state, table_version FROM wallet WHERE wallet_id = ?',
        [id]
      )
      expect(afterDefine).deep.equals([
        {
          cached: 1,
          name: 'Savings',
          wallet_state: JSON.stringify({ sortIndex: 4 }),
          table_version: 5
        }
      ])

      // And the saver's write leaves the table version:
      await saveWalletRows(driver, [makeRow(id, { name: 'Renamed' })])
      const afterSave = await driver.query<{
        name: string
        table_version: number
      }>('SELECT name, table_version FROM wallet WHERE wallet_id = ?', [id])
      expect(afterSave).deep.equals([{ name: 'Renamed', table_version: 5 }])
    })
  })

  it('reads the states of cached and uncached rows alike', async function () {
    await withDb(async driver => {
      const cached = walletId(1)
      const uncached = walletId(2)
      await saveWalletRows(driver, [makeRow(cached)])
      await upsertWalletRow(driver, cached, { walletState: { sortIndex: 1 } })
      await upsertWalletRow(driver, uncached, {
        walletState: { archived: true }
      })

      expect((await readAccountSeed(driver)).walletStates).deep.equals({
        [cached]: { sortIndex: 1 },
        [uncached]: { archived: true }
      })
    })
  })

  it('knows whether it holds a wallet cache', async function () {
    await withDb(async driver => {
      expect(await hasWalletCache(driver)).equals(false)

      await ensureWalletPrefix(driver, walletId(1), 'bitcoin')
      await upsertWalletRow(driver, walletId(2), {
        walletState: { hidden: true }
      })
      expect(await hasWalletCache(driver)).equals(false)

      await saveWalletRows(driver, [makeRow(walletId(3))])
      expect(await hasWalletCache(driver)).equals(true)
    })
  })

  it('reads only the wallets named', async function () {
    await withDb(async driver => {
      await saveWalletRows(driver, [makeRow(walletId(1)), makeRow(walletId(2))])
      expect(
        Object.keys(await readWalletSeeds(driver, [walletId(2)]))
      ).deep.equals([walletId(2)])
      expect(await readWalletSeeds(driver, [])).deep.equals({})
    })
  })

  it('leaves out a row whose columns no longer clean', async function () {
    await withDb(async driver => {
      await saveWalletRows(driver, [makeRow(walletId(1)), makeRow(walletId(2))])
      // Well-formed JSON of the wrong shape:
      await driver.exec([
        {
          sql: 'UPDATE wallet SET enabled_token_ids = ? WHERE wallet_id = ?',
          params: ['{"not":"a list"}', walletId(1)]
        }
      ])
      expect(Object.keys(await readWalletSeeds(driver))).deep.equals([
        walletId(2)
      ])
    })
  })

  it('round-trips a custom token, and a materialization token is not one', async function () {
    await withDb(async driver => {
      await saveTokens(driver, [
        {
          pluginId: 'ethereum',
          tokenId: 'usdc',
          currencyCode: 'USDC',
          multiplier: '1000000'
        }
      ])
      await saveCustomTokens(driver, 'ethereum', { custom: customToken })

      expect((await readAccountSeed(driver)).customTokens).deep.equals({
        ethereum: { custom: customToken }
      })
    })
  })

  it('keeps a shared row when its custom token is removed', async function () {
    await withDb(async driver => {
      // The plugin knows the token too, so the row is both kinds at once:
      await saveCustomTokens(driver, 'ethereum', { custom: customToken })
      await saveTokens(driver, [
        {
          pluginId: 'ethereum',
          tokenId: 'custom',
          currencyCode: 'CUSTOM',
          multiplier: '1000000'
        }
      ])

      await removeCustomToken(driver, 'ethereum', 'custom')

      expect(
        await driver.query(
          `SELECT currency_code, multiplier, is_custom, display_name,
                  denominations, network_location
             FROM token WHERE plugin_id = 'ethereum' AND token_id = 'custom'`
        )
      ).deep.equals([
        {
          currency_code: 'CUSTOM',
          multiplier: '1000000',
          is_custom: 0,
          display_name: null,
          denominations: null,
          network_location: null
        }
      ])
      expect((await readAccountSeed(driver)).customTokens).deep.equals({})
    })
  })

  it('leaves the custom columns when the plugin records the same token', async function () {
    await withDb(async driver => {
      await saveCustomTokens(driver, 'ethereum', { custom: customToken })
      await saveTokens(driver, [
        {
          pluginId: 'ethereum',
          tokenId: 'custom',
          currencyCode: 'CUSTOM',
          multiplier: '1000000'
        }
      ])
      expect((await readAccountSeed(driver)).customTokens).deep.equals({
        ethereum: { custom: customToken }
      })
    })
  })

  it('round-trips the account settings', async function () {
    await withDb(async driver => {
      expect(await readAccountSeed(driver)).deep.equals({
        customTokens: {},
        configOtherMethodNames: {},
        legacyWallets: false,
        walletStates: {}
      })

      await saveAccountSettings(driver, {
        configOtherMethodNames: { bitcoin: ['getSplittableTypes'] },
        legacyWallets: true
      })
      const seed = await readAccountSeed(driver)
      expect(seed.configOtherMethodNames).deep.equals({
        bitcoin: ['getSplittableTypes']
      })
      expect(seed.legacyWallets).equals(true)

      await saveAccountSettings(driver, { legacyWallets: false })
      expect((await readAccountSeed(driver)).legacyWallets).equals(false)
    })
  })

  it('refuses JSON that SQLite cannot read back, naming the column', async function () {
    await withDb(async driver => {
      const id = walletId(1)
      await saveWalletRows(driver, [makeRow(id)])

      for (const column of [
        'wallet_info',
        'enabled_token_ids',
        'other_method_names',
        'staking_status',
        'wallet_state'
      ]) {
        const error = await rejectionOf(
          driver.exec([
            {
              sql: `UPDATE wallet SET ${column} = ? WHERE wallet_id = ?`,
              params: ['{not json', id]
            }
          ])
        )
        expect(String(error)).to.include(`${column}_json`)
      }

      for (const column of ['denominations', 'network_location']) {
        const error = await rejectionOf(
          driver.exec([
            {
              sql: `INSERT INTO token (plugin_id, token_id, currency_code, multiplier, ${column})
                    VALUES ('p', 't', 'C', '1', ?)`,
              params: ['[unterminated']
            }
          ])
        )
        expect(String(error)).to.include(`token_${column}_json`)
      }
    })
  })
})
