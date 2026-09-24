import {
  EdgeAccountDatabase,
  openAccountDatabases
} from '../../src/core/db/account-database'
import {
  readAccountSeed,
  readWalletSeeds
} from '../../src/core/db/wallet-store'
import { EdgeAccount } from '../../src/index'

/**
 * The open database holding a logged-in account's rows.
 *
 * Tests hold a bridged `EdgeAccount`, which has no path back to the core, so
 * this finds the database by what it holds. Two devices logged into the same
 * user at once would both match, and that is refused rather than guessed.
 */
export async function findTestDatabase(
  account: EdgeAccount
): Promise<EdgeAccountDatabase> {
  const matches: EdgeAccountDatabase[] = []
  for (const database of openAccountDatabases.values()) {
    const rows = await database.driver.query(
      'SELECT 1 FROM wallet WHERE wallet_id IN (' +
        account.activeWalletIds.map(() => '?').join(', ') +
        ')',
      account.activeWalletIds
    )
    if (rows.length > 0 || openAccountDatabases.size === 1) {
      matches.push(database)
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected one database for the account, found ${matches.length}`
    )
  }
  return matches[0]
}

/**
 * The account's boot state as the database holds it, in the shape the old
 * account cache file had, so a test reads a field by the same name.
 */
export async function readAccountCache(account: EdgeAccount): Promise<any> {
  const { driver } = await findTestDatabase(account)
  const seed = await readAccountSeed(driver)
  const seeds = await readWalletSeeds(driver)

  const wallets: { [walletId: string]: any } = {}
  for (const walletId of Object.keys(seeds)) {
    const walletSeed = seeds[walletId]
    const balances: { [tokenId: string]: string } = {}
    for (const [tokenId, amount] of walletSeed.balanceMap) {
      balances[tokenId ?? ''] = amount
    }
    wallets[walletId] = {
      walletInfo: walletSeed.publicWalletInfo,
      name: walletSeed.name,
      fiatCurrencyCode: walletSeed.fiatCurrencyCode,
      enabledTokenIds: walletSeed.enabledTokenIds,
      balances,
      addresses: walletSeed.addresses,
      otherMethodNames: walletSeed.otherMethodNames,
      stakingStatus: walletSeed.stakingStatus
    }
  }
  return { ...seed, wallets }
}
