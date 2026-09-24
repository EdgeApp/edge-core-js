import { expect } from 'chai'
import { Disklet } from 'disklet'
import { afterEach, describe, it } from 'mocha'

import { scratchDatabaseHooks } from '../../../src/core/db/scratch-database'
import { fakeWorldTestConfig } from '../../../src/core/fake/fake-world'
import {
  EdgeAccount,
  EdgeCurrencyEngineOptions,
  EdgeMemoryWallet,
  EdgeTxDatabase,
  makeFakeEdgeWorld
} from '../../../src/index'
import {
  fakePluginTestConfig,
  fakeTxDatabases
} from '../../fake/fake-currency-plugin'
import { fakeUser } from '../../fake/fake-user'

/**
 * What an engine gets for storage once plugins keep their state in rows.
 *
 * The wallet's local files can be read, to import them once, and deleted, so
 * a resync can make forgotten history unreachable. They cannot be written.
 */

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('Expecting this promise to reject')
    },
    (error: unknown) => error
  )
}

afterEach(function () {
  fakePluginTestConfig.onEngineOptions = undefined
  fakePluginTestConfig.requireTxDatabase = undefined
  fakeWorldTestConfig.onDeleteSqlDatabase = undefined
  scratchDatabaseHooks.afterOpen = undefined
})

describe('legacy disklet', function () {
  it('reads and deletes the wallet local files, and refuses writes', async function () {
    const options = new Map<string, EdgeCurrencyEngineOptions>()
    fakePluginTestConfig.onEngineOptions = (walletId, opts) =>
      options.set(walletId, opts)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('Broken test account')
    const wallet = await account.waitForCurrencyWallet(walletInfo.id)
    // The fake plugin writes nothing, and starts as it always did:
    expect(wallet.id).equals(walletInfo.id)

    const opts = options.get(walletInfo.id)
    if (opts == null) throw new Error('The engine was never made')
    const legacy: Disklet = opts.legacyDisklet
    // @ts-expect-error The old name is gone.
    expect(opts.walletLocalDisklet).equals(undefined)

    // Files a plugin wrote before, on the same local storage:
    await wallet.localDisklet.setText('old/list.json', '{"a":1}')
    await wallet.localDisklet.setData('old/blob', Uint8Array.from([1, 2]))

    expect(await legacy.getText('old/list.json')).equals('{"a":1}')
    expect([...(await legacy.getData('old/blob'))]).deep.equals([1, 2])
    expect(await legacy.list('old')).deep.equals({
      'old/blob': 'file',
      'old/list.json': 'file'
    })

    for (const write of [
      legacy.setText('old/list.json', '{}'),
      legacy.setData('old/blob', Uint8Array.from([3]))
    ]) {
      const error = await rejectionOf(write)
      expect(String(error)).includes('read-only; use the database')
    }
    expect(await legacy.getText('old/list.json')).equals('{"a":1}')

    await legacy.delete('old/list.json')
    expect(await legacy.list('old')).deep.equals({ 'old/blob': 'file' })

    await account.logout()
  })
})

describe('memory wallet storage', function () {
  const spec = { version: 1, tables: { note: { key: ['id'] } } }

  async function setup(): Promise<{
    makeMemoryWallet: () => Promise<EdgeMemoryWallet>
    accountDatabase: EdgeTxDatabase
    engineDatabase: () => EdgeTxDatabase | undefined
    logout: () => Promise<void>
  }> {
    let memoryDatabase: EdgeTxDatabase | undefined
    fakePluginTestConfig.requireTxDatabase = true
    fakePluginTestConfig.onEngineOptions = (walletId, opts) => {
      if (walletId.startsWith('memorywallet-')) memoryDatabase = opts.txDatabase
    }

    const account = await login()
    const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('Broken test account')
    await account.waitForCurrencyWallet(walletInfo.id)
    const accountDatabase = fakeTxDatabases.get(walletInfo.id)
    if (accountDatabase == null) throw new Error('No account database')

    return {
      makeMemoryWallet: async () =>
        await account.makeMemoryWallet('wallet:fakecoin', {
          keys: { fakeAddress: 'SweptAddress' }
        }),
      accountDatabase,
      engineDatabase: () => memoryDatabase,
      logout: async () => await account.logout()
    }
  }

  async function login(): Promise<EdgeAccount> {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    return await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  }

  it('builds an engine that needs a database, on a scratch one', async function () {
    const deleted: string[] = []
    fakeWorldTestConfig.onDeleteSqlDatabase = name => deleted.push(name)
    const fixture = await setup()

    const memoryWallet = await fixture.makeMemoryWallet()
    const scratch = fixture.engineDatabase()
    if (scratch == null) throw new Error('The engine got no database')
    expect(scratch).not.equals(fixture.accountDatabase)

    // What the swept key's engine writes stays out of the user's storage:
    await scratch.defineTables(spec)
    await scratch.putRows([{ table: 'note', rows: [{ id: 'swept' }] }])
    await fixture.accountDatabase.defineTables(spec)
    const [mine] = await fixture.accountDatabase.getRows([
      { table: 'note', keys: ['swept'] }
    ])
    expect(mine.rows).deep.equals([undefined])

    // Closing the wallet closes the database and deletes the file:
    expect(deleted).deep.equals([])
    await memoryWallet.close()
    expect(deleted.length).equals(1)
    expect(deleted[0].startsWith('scratch-')).equals(true)
    await rejectionOf(scratch.getRows([{ table: 'note', keys: ['swept'] }]))

    await fixture.logout()
  })

  it('rejects naming the scratch database when it will not open', async function () {
    const deleted: string[] = []
    fakeWorldTestConfig.onDeleteSqlDatabase = name => deleted.push(name)
    const fixture = await setup()
    scratchDatabaseHooks.afterOpen = () => {
      throw new Error('disk full')
    }

    const error = await rejectionOf(fixture.makeMemoryWallet())
    expect(String(error)).includes('scratch database')
    expect(fixture.engineDatabase()).equals(undefined)
    // No file left behind:
    expect(deleted.length).equals(1)
    expect(deleted[0].startsWith('scratch-')).equals(true)

    await fixture.logout()
  })

  it('closes the scratch database when the engine fails', async function () {
    const deleted: string[] = []
    fakeWorldTestConfig.onDeleteSqlDatabase = name => deleted.push(name)
    const fixture = await setup()
    fakePluginTestConfig.failEngineFor = 'memorywallet-'
    fakePluginTestConfig.onEngineOptions = walletId => {
      fakePluginTestConfig.failEngineFor = walletId
    }
    try {
      const error = await rejectionOf(fixture.makeMemoryWallet())
      expect(String(error)).includes('Engine exploded')
      expect(deleted.length).equals(1)
      expect(deleted[0].startsWith('scratch-')).equals(true)
    } finally {
      fakePluginTestConfig.failEngineFor = undefined
    }
    await fixture.logout()
  })
})
