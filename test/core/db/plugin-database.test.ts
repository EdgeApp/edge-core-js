import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { EdgeInternalIo, EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { PLUGIN_DATABASE_NAME } from '../../../src/core/db/db-open'
import {
  makePluginDatabase,
  makePluginStore,
  PluginDatabase
} from '../../../src/core/db/plugin-database'
import { RATE_DATABASE_NAME } from '../../../src/core/db/rate-cache'
import { EdgePluginStore, makeFakeEdgeWorld } from '../../../src/index'
import {
  makeMemorySqlDriverFactory,
  makeNodeSqlDriverFactory
} from '../../../src/io/node/node-sql-driver'
import {
  fakeStorePluginOptions,
  lastStoreOptions
} from '../../fake/fake-store-plugin'
import { fakeUser } from '../../fake/fake-user'

/**
 * Storage a plugin owns for itself, on the device.
 *
 * Fee estimates and server lists are the plugin's, not any wallet's, so they
 * live in one device-wide file beside the rate cache, with a table namespace
 * per plugin and the same fence a wallet's tables have.
 */

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true, storeplug: true, storeplugin: true }
}

const spec = {
  version: 1,
  tables: {
    fee: { key: ['id'] },
    server: { key: ['uri'], indexes: { byScore: { paths: ['$.score'] } } }
  }
}

/** An io over memory databases that counts what it is asked to open. */
function countingIo(): {
  io: EdgeInternalIo
  opened: string[]
  deleted: string[]
} {
  const factory = makeMemorySqlDriverFactory()
  const opened: string[] = []
  const deleted: string[] = []
  const io: any = {
    async makeSqlDriver(name: string, key: Uint8Array) {
      opened.push(name)
      if (factory.makeSqlDriver == null) throw new Error('No addon')
      return await factory.makeSqlDriver(name, key)
    },
    async deleteSqlDatabase(name: string) {
      deleted.push(name)
      await factory.deleteSqlDatabase?.(name)
    }
  }
  return { io, opened, deleted }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('Expecting this promise to reject')
    },
    (error: unknown) => error
  )
}

describe('plugin database', function () {
  let database: PluginDatabase | undefined

  afterEach(async function () {
    await database?.close()
    database = undefined
  })

  it('keeps a plugin its own rows, with no account anywhere', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    const store = makePluginStore(database, 'bitcoin')

    await store.defineTables(spec)
    await store.putRows([
      { table: 'fee', rows: [{ id: 'current', high: 9 }] },
      {
        table: 'server',
        rows: [
          { uri: 'wss://a', score: 3 },
          { uri: 'wss://b', score: 1 }
        ]
      }
    ])

    const [fees] = await store.getRows([{ table: 'fee', keys: ['current'] }])
    expect(fees.rows).deep.equals([{ id: 'current', high: 9 }])
    const byScore = await store.findRows('server', {
      orderBy: [{ path: '$.score' }],
      limit: 10
    })
    expect(byScore.length).equals(2)

    const counted = await store.runSql<{ n: number }>`
      SELECT count(*) AS n FROM ${store.server}`
    expect(counted).deep.equals([{ n: 2 }])

    await store.removeRows([{ table: 'server', keys: ['wss://a'] }])
    const [left] = await store.getRows([
      { table: 'server', keys: ['wss://a', 'wss://b'] }
    ])
    expect(left.rows).deep.equals([undefined, { uri: 'wss://b', score: 1 }])
  })

  it('opens the file once, on the first call and not before', async function () {
    const { io, opened } = countingIo()
    database = makePluginDatabase(io)
    const a = makePluginStore(database, 'bitcoin')
    const b = makePluginStore(database, 'litecoin')
    expect(opened).deep.equals([])

    await Promise.all([a.defineTables(spec), b.defineTables(spec)])
    // A store made later shares the driver the first ones opened:
    const late = makePluginStore(database, 'dogecoin')
    await late.defineTables(spec)
    expect(opened).deep.equals([PLUGIN_DATABASE_NAME])
  })

  it('keeps each plugin out of the others', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    const a = makePluginStore(database, 'bitcoin')
    const b = makePluginStore(database, 'litecoin')
    await a.defineTables(spec)
    await b.defineTables(spec)
    await a.putRows([{ table: 'server', rows: [{ uri: 'wss://a', score: 1 }] }])
    await b.putRows([{ table: 'server', rows: [{ uri: 'wss://b', score: 1 }] }])

    const bRows = await b.findRows('server', { limit: 10 })
    expect(bRows).deep.equals([{ uri: 'wss://b', score: 1 }])

    // A handle from one plugin's store, spliced into another's SQL:
    await rejectionOf(b.runSql`SELECT * FROM ${a.server}`)
    // And the registry is no plugin's to read:
    await rejectionOf(b.runSql`SELECT * FROM plugin`)
  })

  it('never lets one prefix contain another', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    // One pair that parses as base64 and one that does not, since the
    // prefix encoding takes a different branch for each:
    for (const [short, long] of [
      ['abcd', 'abcdefgh'],
      ['foo', 'foo-bar']
    ]) {
      const a = makePluginStore(database, short)
      const b = makePluginStore(database, long)
      await a.defineTables(spec)
      await b.defineTables(spec)
      const aName = String(a.fee)
      const bName = String(b.fee)
      const aPrefix = aName.slice(0, aName.length - 'fee'.length)
      const bPrefix = bName.slice(0, bName.length - 'fee'.length)
      expect(aPrefix.startsWith('p_')).equals(true)
      expect(bPrefix.startsWith(aPrefix)).equals(false)
      expect(aPrefix.startsWith(bPrefix)).equals(false)

      await rejectionOf(a.runSql`SELECT * FROM ${b.fee}`)
      await rejectionOf(b.runSql`SELECT * FROM ${a.fee}`)
    }
  })

  it('refuses transactions through the fence', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    const store = makePluginStore(database, 'bitcoin')
    await store.defineTables(spec)
    await rejectionOf(store.runSql`SELECT * FROM tx_chain`)
    await rejectionOf(store.runSql`SELECT * FROM tx_chain_scoped`)
    await rejectionOf(
      // @ts-expect-error A plugin's own storage has no transactions to write.
      store.batchWrite({ saveTxs: [{ txid: 'a' }] })
    )
  })

  it('replaces with putRows and fills gaps with putRowsIfAbsent', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    const store = makePluginStore(database, 'bitcoin')
    await store.defineTables(spec)
    await store.putRows([{ table: 'fee', rows: [{ id: 'a', v: 1 }] }])

    await store.putRowsIfAbsent([
      {
        table: 'fee',
        rows: [
          { id: 'a', v: 2 },
          { id: 'b', v: 2 }
        ]
      }
    ])
    const [kept] = await store.getRows([{ table: 'fee', keys: ['a', 'b'] }])
    expect(kept.rows).deep.equals([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 }
    ])

    await store.putRows([{ table: 'fee', rows: [{ id: 'a', v: 3 }] }])
    const [replaced] = await store.getRows([{ table: 'fee', keys: ['a'] }])
    expect(replaced.rows).deep.equals([{ id: 'a', v: 3 }])
  })

  it('lands a batch whole or not at all', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    const store = makePluginStore(database, 'bitcoin')
    await store.defineTables(spec)

    await store.batchWrite({
      putRows: [{ table: 'fee', rows: [{ id: 'a', v: 1 }] }],
      putRowsIfAbsent: [{ table: 'fee', rows: [{ id: 'b', v: 1 }] }]
    })
    const [landed] = await store.getRows([{ table: 'fee', keys: ['a', 'b'] }])
    expect(landed.rows.length).equals(2)

    // A row with no key fails the batch, and takes the good row with it:
    await rejectionOf(
      store.batchWrite({
        putRows: [{ table: 'fee', rows: [{ id: 'c', v: 1 }] }],
        putRowsIfAbsent: [{ table: 'fee', rows: [{ v: 1 }] }]
      })
    )
    const [none] = await store.getRows([{ table: 'fee', keys: ['c'] }])
    expect(none.rows).deep.equals([undefined])
  })

  it('rebuilds only the plugin whose tables changed version', async function () {
    const { io } = countingIo()
    database = makePluginDatabase(io)
    const a = makePluginStore(database, 'bitcoin')
    const b = makePluginStore(database, 'litecoin')
    await a.defineTables(spec)
    await b.defineTables(spec)
    await a.putRows([{ table: 'fee', rows: [{ id: 'x', v: 1 }] }])
    await b.putRows([{ table: 'fee', rows: [{ id: 'x', v: 1 }] }])

    await a.defineTables({ ...spec, version: 2 })
    const [aRows] = await a.getRows([{ table: 'fee', keys: ['x'] }])
    const [bRows] = await b.getRows([{ table: 'fee', keys: ['x'] }])
    expect(aRows.rows).deep.equals([undefined])
    expect(bRows.rows).deep.equals([{ id: 'x', v: 1 }])
  })

  it('deletes a file that will not open, and tries once more', async function () {
    const { io, deleted } = countingIo()
    const open = io.makeSqlDriver as NonNullable<
      EdgeInternalIo['makeSqlDriver']
    >
    let failures = 1
    io.makeSqlDriver = async (name, key) => {
      if (failures-- > 0) throw new Error('file is not a database')
      return await open(name, key)
    }
    database = makePluginDatabase(io)
    const store = makePluginStore(database, 'bitcoin')
    await store.defineTables(spec)
    expect(deleted).deep.equals([PLUGIN_DATABASE_NAME])
  })

  it('names the plugin database when it cannot open at all', async function () {
    const { io, deleted } = countingIo()
    io.makeSqlDriver = async () => {
      throw new Error('file is not a database')
    }
    database = makePluginDatabase(io)
    const store = makePluginStore(database, 'bitcoin')
    const error = await rejectionOf(store.defineTables(spec))
    expect(String(error)).includes('plugin database')
    expect(deleted).deep.equals([PLUGIN_DATABASE_NAME])

    // Not remembered: the next call tries again.
    await rejectionOf(store.getRows([]))
    expect(deleted.length).equals(2)
  })

  it('names the plugin database on a platform with no SQL binding', async function () {
    database = makePluginDatabase({} as unknown as EdgeInternalIo)
    const store = makePluginStore(database, 'bitcoin')
    expect(String(await rejectionOf(store.defineTables(spec)))).includes(
      'plugin database'
    )
  })

  it('closes, and does not reopen after', async function () {
    const { io } = countingIo()
    const local = makePluginDatabase(io)
    const store = makePluginStore(local, 'bitcoin')
    await store.defineTables(spec)
    const driver: EdgeSqlDriver = await local.driver()
    await local.close()
    await local.close()
    expect(String(await rejectionOf(local.driver()))).includes('closed')
    await rejectionOf(driver.query('SELECT 1'))

    // Closing before anything opened is fine too:
    await makePluginDatabase(io).close()
  })
})

describe('unkeyed databases', function () {
  it('opens the two device-wide databases without a key, and nothing else', async function () {
    const factory = makeNodeSqlDriverFactory(
      `/tmp/edge-core-unkeyed-${Date.now()}`
    )
    if (factory.makeSqlDriver == null) this.skip()
    const empty = new Uint8Array(0)
    const rates = await factory.makeSqlDriver(RATE_DATABASE_NAME, empty)
    const plugins = await factory.makeSqlDriver(PLUGIN_DATABASE_NAME, empty)
    await rates.close()
    await plugins.close()
    await rejectionOf(factory.makeSqlDriver('account', empty))
  })
})

describe('plugin database in a context', function () {
  afterEach(function () {
    for (const id of Object.keys(fakeStorePluginOptions)) {
      fakeStorePluginOptions[id] = []
    }
  })

  function storeOf(pluginId: string): EdgePluginStore {
    return lastStoreOptions(pluginId).pluginDatabase
  }

  it('hands every plugin a store that outlives logout', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    const store = storeOf('storeplug')
    await store.defineTables(spec)
    await store.putRows([{ table: 'fee', rows: [{ id: 'current', v: 1 }] }])

    // An account comes and goes; the plugin's rows stay:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.logout()
    const [rows] = await store.getRows([{ table: 'fee', keys: ['current'] }])
    expect(rows.rows).deep.equals([{ id: 'current', v: 1 }])
    await context.close()

    // A fresh process on the same device finds them:
    const context2 = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    const again = storeOf('storeplug')
    await again.defineTables(spec)
    const [still] = await again.getRows([{ table: 'fee', keys: ['current'] }])
    expect(still.rows).deep.equals([{ id: 'current', v: 1 }])

    // Closing the context closes the file, and nothing reopens it:
    await context2.close()
    expect(String(await rejectionOf(again.getRows([])))).includes('closed')

    // Another device does not:
    await world.makeEdgeContext(contextOptions)
    const elsewhere = storeOf('storeplug')
    await elsewhere.defineTables(spec)
    const [none] = await elsewhere.getRows([
      { table: 'fee', keys: ['current'] }
    ])
    expect(none.rows).deep.equals([undefined])
  })

  it('still makes a context with no SQL binding, and says so on use', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      sqlDriver: 'none'
    })
    const error = await rejectionOf(storeOf('storeplug').defineTables(spec))
    expect(String(error)).includes('plugin database')
    // And a login still fails where part one says, at the account database:
    const login = await rejectionOf(
      context.loginWithPIN(fakeUser.username, fakeUser.pin)
    )
    expect(String(login)).includes('account database')
  })
})
