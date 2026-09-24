import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import {
  loadAccountSeed,
  walletCacheLoaderHooks
} from '../../../../src/core/currency/wallet/wallet-cache-loader'
import { EdgeSqlDriver } from '../../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../../src/core/db/db-open'
import {
  saveAccountSettings,
  saveWalletRows,
  upsertWalletRow
} from '../../../../src/core/db/wallet-store'
import { ApiInput } from '../../../../src/core/root-pixie'
import { makeMemorySqlDriver } from '../../../../src/io/node/node-sql-driver'

/**
 * Whether a login boots warm, and from what.
 *
 * Warm needs a cached wallet row and an account with no legacy Airbitz
 * wallets. Everything else is cold, and a read that fails is cold too --
 * never a failed login.
 */

function fakeAi(warnings: string[]): ApiInput {
  const log: any = () => {}
  log.warn = (message: string) => warnings.push(message)
  log.error = () => {}
  return { props: { log } } as unknown as ApiInput
}

async function makeDb(): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  return driver
}

async function cacheOneWallet(driver: EdgeSqlDriver): Promise<void> {
  const id = Buffer.alloc(32, 1).toString('base64')
  await saveWalletRows(driver, [
    {
      walletId: id,
      pluginId: 'fakecoin',
      walletInfo: { id, type: 'wallet:fakecoin', keys: {} },
      name: 'Cached',
      fiatCurrencyCode: 'iso:USD',
      enabledTokenIds: [],
      otherMethodNames: []
    }
  ])
}

describe('wallet cache loader', function () {
  afterEach(function () {
    walletCacheLoaderHooks.beforeAccountSeed = undefined
  })

  it('boots cold with no cached wallet', async function () {
    const driver = await makeDb()
    try {
      await upsertWalletRow(driver, 'state-only', {
        walletState: { archived: true }
      })
      expect(await loadAccountSeed(fakeAi([]), driver)).equals(undefined)
    } finally {
      await driver.close()
    }
  })

  it('boots warm from a cached wallet', async function () {
    const driver = await makeDb()
    try {
      await cacheOneWallet(driver)
      await upsertWalletRow(driver, 'state-only', {
        walletState: { archived: true }
      })
      const seed = await loadAccountSeed(fakeAi([]), driver)
      expect(seed?.walletStates).deep.equals({
        'state-only': { archived: true }
      })
    } finally {
      await driver.close()
    }
  })

  it('boots cold for an account with legacy wallets', async function () {
    const driver = await makeDb()
    try {
      await cacheOneWallet(driver)
      await saveAccountSettings(driver, { legacyWallets: true })
      expect(await loadAccountSeed(fakeAi([]), driver)).equals(undefined)
    } finally {
      await driver.close()
    }
  })

  it('boots cold, and says so, when the read fails', async function () {
    const driver = await makeDb()
    try {
      await cacheOneWallet(driver)
      walletCacheLoaderHooks.beforeAccountSeed = () => {
        throw new Error('Unreadable')
      }
      const warnings: string[] = []
      expect(await loadAccountSeed(fakeAi(warnings), driver)).equals(undefined)
      expect(warnings.length).equals(1)
      expect(warnings[0]).includes('Unreadable')
    } finally {
      await driver.close()
    }
  })
})
