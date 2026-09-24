import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'
import { base64 } from 'rfc4648'

import { accountCacheSaverConfig } from '../../../../src/core/account/account-cache-saver'
import { walletCacheImportHooks } from '../../../../src/core/currency/wallet/wallet-cache-import'
import { fakeWorldTestConfig } from '../../../../src/core/fake/fake-world'
import {
  EdgeAccount,
  EdgeFakeWorld,
  makeFakeEdgeWorld
} from '../../../../src/index'
import { base58 } from '../../../../src/util/encoding'
import { snooze } from '../../../../src/util/snooze'
import {
  createEngineGate,
  fakePluginTestConfig
} from '../../../fake/fake-currency-plugin'
import { fakeUser } from '../../../fake/fake-user'
import {
  findTestDatabase,
  readAccountCache
} from '../../../fake/wallet-cache-rows'

/**
 * Moving the old wallet cache files into the account database.
 *
 * A device upgrading from a build that kept the boot cache as JSON has the
 * files and no rows. The import copies them once, in one transaction, and
 * deletes them; the database itself is the marker that it happened.
 */

const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true }
}
const quiet = { onLog() {} }
const SAVE_WAIT_MS = 300
const RACE_WAIT_MS = 150

const CACHE_FILES = [
  'accountCache.json',
  'accountCache.2.json',
  'walletCache.json',
  'publicKey.json'
]

function byString(a: string, b: string): number {
  return a.localeCompare(b)
}

/** The disklet path of a file on a wallet's or account's local storage. */
function localPath(id: string, file: string): string {
  return `local/${base58.stringify(base64.parse(id))}/${file}`
}

interface Ids {
  world: EdgeFakeWorld
  accountRepoId: string
  walletIds: string[]
}

/** The ids a file fixture has to name, from one throwaway login. */
async function discover(): Promise<Ids> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext(contextOptions)
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  const repo = account.getFirstWalletInfo('account-repo:co.airbitz.wallet')
  if (repo == null) throw new Error('Broken test account')
  const walletIds = [...account.activeWalletIds]
  await account.logout()
  return { world, accountRepoId: repo.id, walletIds }
}

function cachedWallet(id: string, name: string): object {
  return {
    walletInfo: {
      id,
      type: 'wallet:fakecoin',
      keys: { fakeAddress: 'FakePublicAddress' }
    },
    name,
    fiatCurrencyCode: 'iso:EUR',
    enabledTokenIds: [],
    balances: { '': '12345' },
    addresses: {
      '': [{ addressType: 'publicAddress', publicAddress: `addr-${name}` }]
    },
    otherMethodNames: ['testMethod']
  }
}

function accountFile(opts: {
  sequence?: number
  wallets: { [walletId: string]: object }
  walletStates?: object
}): string {
  return JSON.stringify({
    version: 2,
    sequence: opts.sequence ?? 1,
    customTokens: {
      fakecoin: {
        imported: {
          currencyCode: 'IMP',
          displayName: 'Imported Token',
          denominations: [{ name: 'IMP', multiplier: '100' }],
          networkLocation: { contractAddress: '0xIMP' }
        }
      }
    },
    legacyWallets: false,
    walletStates: opts.walletStates ?? {},
    configOtherMethodNames: { fakecoin: ['fakePluginMethod'] },
    wallets: opts.wallets
  })
}

async function cachedRows(account: EdgeAccount): Promise<string[]> {
  const { driver } = await findTestDatabase(account)
  const rows = await driver.query<{ wallet_id: string }>(
    'SELECT wallet_id FROM wallet WHERE cached = 1 ORDER BY wallet_id'
  )
  return rows.map(row => row.wallet_id)
}

async function hasFile(
  account: EdgeAccount,
  id: string,
  file: string
): Promise<boolean> {
  const disklet =
    id === account.getFirstWalletInfo('account-repo:co.airbitz.wallet')?.id
      ? account.localDisklet
      : (await account.waitForCurrencyWallet(id)).localDisklet
  return await disklet.getText(file).then(
    () => true,
    () => false
  )
}

describe('wallet cache import', function () {
  beforeEach(function () {
    accountCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    accountCacheSaverConfig.throttleMs = 5000
    walletCacheImportHooks.beforeCommit = undefined
    fakeWorldTestConfig.onRead = undefined
    fakeWorldTestConfig.onWrite = undefined
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.onDerivePublicKey = undefined
  })

  it('copies the files into rows, then deletes them', async function () {
    this.timeout(15000)
    const { world, accountRepoId, walletIds } = await discover()
    const [a, b] = walletIds
    const extraFiles = {
      [localPath(accountRepoId, 'accountCache.json')]: accountFile({
        wallets: {
          [a]: cachedWallet(a, 'Imported A'),
          [b]: cachedWallet(b, 'Imported B')
        },
        walletStates: { [b]: { sortIndex: 1 } }
      })
    }
    const context = await world.makeEdgeContext({
      ...contextOptions,
      extraFiles
    })

    // The imported rows boot this very login warm, engines held:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(a)
    expect(wallet.name).equals('Imported A')
    expect(wallet.balances.FAKE).equals('12345')

    const cache = await readAccountCache(account)
    expect(Object.keys(cache.wallets).sort(byString)).deep.equals(
      [a, b].sort(byString)
    )
    expect(cache.wallets[b].addresses['']).deep.equals([
      { addressType: 'publicAddress', publicAddress: 'addr-Imported B' }
    ])
    expect(cache.walletStates[b]).deep.equals({ sortIndex: 1 })
    expect(cache.customTokens.fakecoin.imported.currencyCode).equals('IMP')
    expect(cache.configOtherMethodNames.fakecoin).deep.equals([
      'fakePluginMethod'
    ])
    expect(await hasFile(account, accountRepoId, 'accountCache.json')).equals(
      false
    )
    release()
    await account.logout()
  })

  it('reads no file once the database holds a cache', async function () {
    this.timeout(15000)
    const { world, walletIds } = await discover()
    const context = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    const first = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await first.waitForAllWallets()
    await snooze(SAVE_WAIT_MS)
    await first.logout()

    // Files on disk that the next login must never look at:
    const again = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    const reads: string[] = []
    fakeWorldTestConfig.onRead = path => reads.push(path)
    const account = await again.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()
    fakeWorldTestConfig.onRead = undefined

    expect(
      reads.filter(path => CACHE_FILES.some(file => path.endsWith(file)))
    ).deep.equals([])
    expect(await cachedRows(account)).deep.equals([...walletIds].sort(byString))
    await account.logout()
  })

  it('keeps a state whose wallet has no entry, as a row that seeds nothing', async function () {
    this.timeout(15000)
    const { world, accountRepoId, walletIds } = await discover()
    const [a, b] = walletIds
    const context = await world.makeEdgeContext({
      ...contextOptions,
      extraFiles: {
        [localPath(accountRepoId, 'accountCache.json')]: accountFile({
          wallets: { [a]: cachedWallet(a, 'Imported A') },
          walletStates: { [b]: { archived: true } }
        })
      }
    })
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Seeded as archived before any file of the account loads:
    expect([...account.archivedWalletIds]).deep.equals([b])
    const { driver } = await findTestDatabase(account)
    expect(
      await driver.query(
        'SELECT cached, wallet_state FROM wallet WHERE wallet_id = ?',
        [b]
      )
    ).deep.equals([{ cached: 0, wallet_state: '{"archived":true}' }])
    release()
    await account.logout()
  })

  it('boots cold with no files and no rows', async function () {
    this.timeout(15000)
    const { world } = await discover()
    const context = await world.makeEdgeContext(contextOptions)
    const errors: unknown[] = []
    context.on('error', error => errors.push(error))

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    let settled = false
    const login = context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(account => {
        settled = true
        return account
      })
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)
    release()
    const account = await login
    await account.waitForAllWallets()
    expect(errors).deep.equals([])
    await account.logout()
  })

  it('takes the newest slot that still parses', async function () {
    this.timeout(15000)
    const { world, accountRepoId, walletIds } = await discover()
    const [a] = walletIds
    const newest = accountFile({
      sequence: 9,
      wallets: { [a]: cachedWallet(a, 'Torn Newest') }
    })
    const context = await world.makeEdgeContext({
      ...contextOptions,
      extraFiles: {
        // A kill mid-write tore the newer generation:
        [localPath(accountRepoId, 'accountCache.json')]: newest.slice(
          0,
          Math.floor(newest.length / 2)
        ),
        [localPath(accountRepoId, 'accountCache.2.json')]: accountFile({
          sequence: 8,
          wallets: { [a]: cachedWallet(a, 'Intact Older') }
        })
      }
    })
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect((await account.waitForCurrencyWallet(a)).name).equals('Intact Older')
    release()
    await account.logout()
  })

  it('imports a version-1 account file and a wallet from its own files', async function () {
    this.timeout(15000)
    const { world, accountRepoId, walletIds } = await discover()
    const [a] = walletIds
    const context = await world.makeEdgeContext({
      ...contextOptions,
      extraFiles: {
        // A version-1 account file carries no wallets:
        [localPath(accountRepoId, 'accountCache.json')]: JSON.stringify({
          version: 1,
          customTokens: {},
          legacyWallets: false,
          walletStates: {},
          configOtherMethodNames: {}
        }),
        // So the wallet comes from its own pair, in the version-1 layout:
        [localPath(a, 'walletCache.json')]: JSON.stringify({
          version: 1,
          name: 'Own Files',
          fiatCurrencyCode: 'iso:USD',
          enabledTokenIds: [],
          balances: { '': '77' }
        }),
        [localPath(a, 'publicKey.json')]: JSON.stringify({
          walletInfo: {
            id: a,
            type: 'wallet:fakecoin',
            keys: { fakeAddress: 'FakePublicAddress' }
          }
        })
      }
    })
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(a)
    expect(wallet.name).equals('Own Files')
    expect(wallet.balances.FAKE).equals('77')
    expect(await hasFile(account, a, 'walletCache.json')).equals(false)
    expect(await hasFile(account, a, 'publicKey.json')).equals(false)
    release()
    await account.logout()
  })

  it('leaves everything in place when the import cannot commit', async function () {
    this.timeout(15000)
    const { world, accountRepoId, walletIds } = await discover()
    const [a, b] = walletIds
    const context = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone',
      extraFiles: {
        [localPath(accountRepoId, 'accountCache.json')]: accountFile({
          wallets: {
            [a]: cachedWallet(a, 'Imported A'),
            [b]: cachedWallet(b, 'Imported B')
          }
        })
      }
    })
    walletCacheImportHooks.beforeCommit = () => {
      throw new Error('The disk is full')
    }
    const errors: unknown[] = []
    context.on('error', error => errors.push(error))

    // The login still succeeds, cold, and no cache is written behind it:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()
    await snooze(SAVE_WAIT_MS)
    expect(await cachedRows(account)).deep.equals([])
    expect(await hasFile(account, accountRepoId, 'accountCache.json')).equals(
      true
    )
    expect(errors).deep.equals([])
    await account.logout()

    // The next login imports, with nothing lost:
    walletCacheImportHooks.beforeCommit = undefined
    const again = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    const account2 = await again.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(await cachedRows(account2)).deep.equals([a, b].sort(byString))
    expect(await hasFile(account2, accountRepoId, 'accountCache.json')).equals(
      false
    )
    await account2.logout()
  })

  it('derives keys only until the rows hold them', async function () {
    this.timeout(15000)
    const { world } = await discover()
    const context = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    let derived = 0
    fakePluginTestConfig.onDerivePublicKey = () => ++derived

    // Nothing cached: every wallet derives.
    const cold = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await cold.waitForAllWallets()
    await snooze(SAVE_WAIT_MS)
    await cold.logout()
    expect(derived).greaterThan(0)

    // Cached: none does.
    derived = 0
    const warm = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await warm.waitForAllWallets()
    expect(derived).equals(0)
    await warm.logout()
  })

  it('never writes a cache file, even for a wallet made after boot', async function () {
    this.timeout(15000)
    const { world } = await discover()
    const context = await world.makeEdgeContext(contextOptions)
    const writes: string[] = []
    fakeWorldTestConfig.onWrite = path => writes.push(path)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()
    const wallet = await account.createCurrencyWallet('wallet:fakecoin', {
      name: 'After Boot'
    })
    await snooze(SAVE_WAIT_MS)
    expect(await cachedRows(account)).includes(wallet.id)
    await account.logout()

    expect(
      writes.filter(path => CACHE_FILES.some(file => path.endsWith(file)))
    ).deep.equals([])
  })
})
