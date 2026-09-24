import {
  asArray,
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
  Cleaner
} from 'cleaners'
import { Disklet } from 'disklet'

import {
  EdgeAddress,
  EdgePluginMap,
  EdgeStakingStatus,
  EdgeTokenMap,
  EdgeWalletInfo,
  EdgeWalletStates
} from '../../../types/types'
import { asJsonObject, makeJsonFile } from '../../../util/file-helpers'
import {
  asCachedStakingStatus,
  asEdgeToken,
  asEdgeWalletState
} from '../../account/account-cleaners'
import { EdgeSqlDriver, EdgeSqlStatement } from '../../db/db-driver'
import {
  accountSettingsStatements,
  addressStatements,
  balanceStatements,
  customTokenStatement,
  hasWalletCache,
  resolveWalletPrefixes,
  walletCacheStatement,
  walletRowStatement
} from '../../db/wallet-store'
import { maybeFindCurrencyPluginId } from '../../plugins/plugins-selectors'
import { ApiInput } from '../../root-pixie'
import { makeLocalDisklet } from '../../storage/repo'
import { asIntegerString } from './currency-wallet-cleaners'

/**
 * Moving the wallet cache files into the account database, once.
 *
 * Builds before this one kept the boot cache as JSON on the local disk: one
 * account file in two alternating slots, and before that a pair of files per
 * wallet. This is the only module that still knows those shapes. It reads
 * them when the database holds no wallet cache yet, writes everything they
 * held in one transaction, and deletes them. After that nothing reads or
 * writes them, because nothing here can.
 */

// ---------------------------------------------------------------------
// The file shapes
// ---------------------------------------------------------------------

/** The two slots the account file alternated between. */
const ACCOUNT_CACHE_FILES = ['accountCache.json', 'accountCache.2.json']
const WALLET_CACHE_FILE = 'walletCache.json'
const PUBLIC_KEY_FILE = 'publicKey.json'

/** One wallet's entry in the account file. */
export interface AccountCacheWallet {
  walletInfo: { id: string; keys: object; type: string }
  name: string | null
  fiatCurrencyCode: string
  enabledTokenIds: string[]
  /** Integer strings. The `null` tokenId is spelled '' here. */
  balances: { [tokenId: string]: string }
  /** Per tokenId (`null` spelled ''), without balances. */
  addresses: { [tokenIdKey: string]: EdgeAddress[] }
  otherMethodNames: string[]
  stakingStatus?: EdgeStakingStatus
}

export interface AccountCacheFile {
  version: 2
  customTokens: EdgePluginMap<EdgeTokenMap>
  legacyWallets: boolean
  walletStates: EdgeWalletStates
  configOtherMethodNames: EdgePluginMap<string[]>
  wallets: { [walletId: string]: AccountCacheWallet }
  sequence: number
}

/** A wallet's own file, from before the account file carried wallets. */
export interface WalletCacheFile {
  version: 2
  name: string | null
  fiatCurrencyCode: string
  enabledTokenIds: string[]
  balances: { [tokenId: string]: string }
  addresses: { [tokenIdKey: string]: EdgeAddress[] }
  otherMethodNames: string[]
}

const asCachedAddress = asObject({
  addressType: asString,
  publicAddress: asString
})

const asFileWalletInfo = asObject({
  id: asString,
  keys: asJsonObject,
  type: asString
})

const asAccountCacheWallet = asObject<AccountCacheWallet>({
  walletInfo: asFileWalletInfo,
  name: asEither(asString, asNull),
  fiatCurrencyCode: asString,
  enabledTokenIds: asArray(asString),
  balances: asObject(asIntegerString),
  addresses: asObject(asArray(asCachedAddress)),
  otherMethodNames: asArray(asString),
  stakingStatus: asOptional(asCachedStakingStatus)
})

export const asAccountCacheFile: Cleaner<AccountCacheFile> = asObject({
  version: asValue(2),
  sequence: asNumber,
  customTokens: asObject(asObject(asEdgeToken)),
  legacyWallets: asOptional(asBoolean, false),
  walletStates: asObject(asEdgeWalletState),
  configOtherMethodNames: asOptional(asObject(asArray(asString)), () => ({})),
  wallets: asObject(asAccountCacheWallet)
})

const asAccountCacheFileV1 = asObject({
  version: asValue(1),
  customTokens: asObject(asObject(asEdgeToken)),
  legacyWallets: asOptional(asBoolean, false),
  walletStates: asObject(asEdgeWalletState),
  configOtherMethodNames: asOptional(asObject(asArray(asString)), () => ({}))
})

/**
 * Either version of the account file. A version-1 file predates the wallet
 * table, so its wallets are still in their own files.
 */
export const asStoredAccountCacheFile: Cleaner<AccountCacheFile> = raw => {
  try {
    return asAccountCacheFile(raw)
  } catch (error: unknown) {
    const clean = asAccountCacheFileV1(raw)
    return { ...clean, version: 2, sequence: 0, wallets: {} }
  }
}

export const asWalletCacheFile: Cleaner<WalletCacheFile> = asObject({
  version: asValue(2),
  name: asEither(asString, asNull),
  fiatCurrencyCode: asString,
  enabledTokenIds: asArray(asString),
  balances: asObject(asIntegerString),
  addresses: asObject(asArray(asCachedAddress)),
  otherMethodNames: asOptional(asArray(asString), () => [])
})

export const asWalletCacheFileV1 = asObject({
  version: asValue(1),
  name: asEither(asString, asNull),
  fiatCurrencyCode: asString,
  enabledTokenIds: asArray(asString),
  balances: asObject(asIntegerString)
})

/** Either version of a wallet's own file; the older lacks what it lacks. */
export const asStoredWalletCacheFile: Cleaner<WalletCacheFile> = raw => {
  try {
    return asWalletCacheFile(raw)
  } catch (error: unknown) {
    const clean = asWalletCacheFileV1(raw)
    return { ...clean, version: 2, addresses: {}, otherMethodNames: [] }
  }
}

export const asPublicKeyFile = asObject({ walletInfo: asFileWalletInfo })

const accountCacheFile = makeJsonFile(asStoredAccountCacheFile)
const walletCacheFile = makeJsonFile(asStoredWalletCacheFile)
const publicKeyFile = makeJsonFile(asPublicKeyFile)

// ---------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------

export const walletCacheImportHooks: {
  /** Test hook: runs just before the import's transaction; throwing fails it. */
  beforeCommit?: () => void
} = {}

/** What the import found to move, and where it found it. */
interface FoundFiles {
  accountId: string
  account: AccountCacheFile | undefined
  wallets: { [walletId: string]: AccountCacheWallet }
  /** Every file that parsed, as a disklet and a path, to delete after. */
  read: Array<[Disklet, string]>
}

/**
 * Copies the wallet cache files into the database, if the database holds no
 * wallet cache yet, and deletes them once the copy has committed.
 *
 * The marker is the database, not the files: a cached row means the import
 * is done, whatever the disk still has. A failure to commit leaves every
 * file in place and tells the account, which then boots cold and writes no
 * cache of its own for the session, so the next login imports again with
 * nothing lost. Nothing here fails a login.
 */
export async function importWalletCacheFiles(
  ai: ApiInput,
  accountId: string,
  driver: EdgeSqlDriver
): Promise<void> {
  const { log } = ai.props
  try {
    if (await hasWalletCache(driver)) return
  } catch (error: unknown) {
    log.warn(`Login: wallet cache marker unreadable: ${String(error)}`)
    return
  }

  const accountState = ai.props.state.accounts[accountId]
  if (accountState == null) return
  const found = await readFiles(ai, accountId)
  if (found.account == null && Object.keys(found.wallets).length === 0) return

  try {
    const statements = await importStatements(ai, driver, found)
    walletCacheImportHooks.beforeCommit?.()
    await driver.batch(statements)
  } catch (error: unknown) {
    log.warn(`Login: wallet cache import failed: ${String(error)}`)
    ai.props.dispatch({
      type: 'ACCOUNT_WALLET_CACHE_IMPORT_FAILED',
      payload: { accountId }
    })
    return
  }
  log.warn(
    `Login: imported ${Object.keys(found.wallets).length} cached wallets`
  )

  // The rows are what count now. A file left behind by a kill here is never
  // read again, because the marker query ends the next import at its start:
  for (const [disklet, path] of found.read) {
    await disklet.delete(path).catch(() => undefined)
  }
}

async function readFiles(ai: ApiInput, accountId: string): Promise<FoundFiles> {
  const { io } = ai.props
  const accountState = ai.props.state.accounts[accountId]
  const read: Array<[Disklet, string]> = []

  // The account file, newest slot that parses:
  const accountDisklet = makeLocalDisklet(io, accountState.accountWalletInfo.id)
  let account: AccountCacheFile | undefined
  for (const path of ACCOUNT_CACHE_FILES) {
    const file = await accountCacheFile.load(accountDisklet, path)
    if (file == null) continue
    read.push([accountDisklet, path])
    if (account == null || file.sequence > account.sequence) account = file
  }

  // Each wallet's own pair, for wallets the account file does not carry:
  const wallets: { [walletId: string]: AccountCacheWallet } = {
    ...account?.wallets
  }
  for (const walletId of Object.keys(accountState.walletInfos)) {
    const disklet = makeLocalDisklet(io, walletId)
    const [walletFile, keyFile] = await Promise.all([
      walletCacheFile.load(disklet, WALLET_CACHE_FILE),
      publicKeyFile.load(disklet, PUBLIC_KEY_FILE)
    ])
    if (walletFile != null) read.push([disklet, WALLET_CACHE_FILE])
    if (keyFile != null) read.push([disklet, PUBLIC_KEY_FILE])
    if (wallets[walletId] != null || walletFile == null || keyFile == null) {
      continue
    }
    wallets[walletId] = {
      walletInfo: keyFile.walletInfo,
      name: walletFile.name,
      fiatCurrencyCode: walletFile.fiatCurrencyCode,
      enabledTokenIds: walletFile.enabledTokenIds,
      balances: walletFile.balances,
      addresses: walletFile.addresses,
      otherMethodNames: walletFile.otherMethodNames
    }
  }

  return { accountId, account, wallets, read }
}

async function importStatements(
  ai: ApiInput,
  driver: EdgeSqlDriver,
  found: FoundFiles
): Promise<EdgeSqlStatement[]> {
  const plugins = ai.props.state.plugins.currency
  const { account, wallets } = found
  const walletStates = account?.walletStates ?? {}
  const prefixes = await resolveWalletPrefixes(driver, [
    ...Object.keys(wallets),
    ...Object.keys(walletStates)
  ])
  const prefixOf = (walletId: string): string =>
    prefixes.get(walletId) as string

  const out: EdgeSqlStatement[] = []
  for (const walletId of Object.keys(wallets)) {
    const wallet = wallets[walletId]
    const walletInfo: EdgeWalletInfo = wallet.walletInfo
    out.push(
      walletCacheStatement(prefixOf(walletId), {
        walletId,
        pluginId: maybeFindCurrencyPluginId(plugins, walletInfo.type) ?? null,
        walletInfo,
        name: wallet.name,
        fiatCurrencyCode: wallet.fiatCurrencyCode,
        enabledTokenIds: wallet.enabledTokenIds,
        otherMethodNames: wallet.otherMethodNames,
        stakingStatus: wallet.stakingStatus
      }),
      ...balanceStatements(
        walletId,
        Object.keys(wallet.balances).map(tokenId => [
          tokenId === '' ? null : tokenId,
          wallet.balances[tokenId]
        ])
      )
    )
    for (const key of Object.keys(wallet.addresses)) {
      out.push(...addressStatements(walletId, key, wallet.addresses[key]))
    }
  }

  // A state can exist with no wallet entry -- a deleted wallet keeps one --
  // and it gets a row of its own, which seeds nothing:
  const { walletInfos } = ai.props.state.accounts[found.accountId]
  for (const walletId of Object.keys(walletStates)) {
    const type = walletInfos[walletId]?.type
    const pluginId =
      type == null ? undefined : maybeFindCurrencyPluginId(plugins, type)
    out.push(
      walletRowStatement(walletId, prefixOf(walletId), {
        ...(pluginId != null ? { pluginId } : {}),
        walletState: walletStates[walletId]
      })
    )
  }

  if (account != null) {
    for (const pluginId of Object.keys(account.customTokens)) {
      const tokens = account.customTokens[pluginId]
      for (const tokenId of Object.keys(tokens)) {
        out.push(customTokenStatement(pluginId, tokenId, tokens[tokenId]))
      }
    }
    out.push(
      ...accountSettingsStatements({
        configOtherMethodNames: account.configOtherMethodNames,
        legacyWallets: account.legacyWallets
      })
    )
  }
  return out
}
