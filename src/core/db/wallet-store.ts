import {
  asArray,
  asBoolean,
  asMaybe,
  asObject,
  asString,
  Cleaner
} from 'cleaners'

import {
  EdgeAddress,
  EdgeBalanceMap,
  EdgePluginMap,
  EdgeStakingStatus,
  EdgeToken,
  EdgeTokenMap,
  EdgeWalletInfo,
  EdgeWalletState,
  EdgeWalletStates
} from '../../types/types'
import { asJsonObject } from '../../util/file-helpers'
import {
  asCachedStakingStatus,
  asEdgeToken,
  asEdgeWalletState
} from '../account/account-cleaners'
import { EdgeSqlDriver, EdgeSqlStatement, EdgeSqlValue } from './db-driver'
import { walletTablePrefix } from './plugin-tables'

/**
 * The account's boot state, as rows.
 *
 * Design:
 * https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md
 *
 * This is what the account shows before any engine exists: the wallet list,
 * each wallet's name, balances and receive addresses, and the custom tokens
 * and wallet states that decide what is listed at all. It used to be one JSON
 * document per account, rewritten whole on every change -- so a balance
 * arriving for one token cost a rewrite of every wallet's balances. Here a
 * balance is a row.
 *
 * Every write is a list of statements, so a caller that changed several
 * things -- the saver, the import -- lands them in one transaction by handing
 * them all to one `driver.batch`. The `save*` functions are the same
 * statements, batched on their own.
 */

/**
 * One wallet's boot state, ready to seed Redux: the public keys, and the UI
 * state the account showed last time.
 */
export interface WalletCacheSeed {
  addresses: { [tokenIdKey: string]: EdgeAddress[] }
  balanceMap: EdgeBalanceMap
  enabledTokenIds: string[]
  fiatCurrencyCode: string
  name: string | null
  otherMethodNames: string[]
  publicWalletInfo: EdgeWalletInfo
  stakingStatus?: EdgeStakingStatus
}

/** The account-level half of the boot state. */
export interface AccountSeed {
  customTokens: EdgePluginMap<EdgeTokenMap>
  configOtherMethodNames: EdgePluginMap<string[]>
  legacyWallets: boolean
  walletStates: EdgeWalletStates
}

/**
 * The columns a wallet row can be written with.
 *
 * **Only the ones present are written.** A wallet row has two writers -- the
 * plugin tables, which own `plugin_id` and `table_version`, and the boot-state
 * saver, which owns the rest -- and neither may clobber the other's columns.
 * So the upsert's update list is built from exactly the keys passed, and a
 * key set to `undefined` is the same as a key left out. `null` is a value:
 * it clears the column.
 */
export interface WalletRowColumns {
  pluginId?: string | null
  tableVersion?: number | null
  cached?: boolean
  walletInfo?: EdgeWalletInfo | null
  name?: string | null
  fiatCode?: string | null
  enabledTokenIds?: string[] | null
  otherMethodNames?: string[] | null
  stakingStatus?: EdgeStakingStatus | null
  walletState?: EdgeWalletState | null
  metaMirrored?: boolean
}

/** Every wallet column's name, and how its value is spelled for SQLite. */
const walletColumns: {
  [K in keyof WalletRowColumns]-?: [
    string,
    (value: NonNullable<WalletRowColumns[K]> | null) => EdgeSqlValue
  ]
} = {
  pluginId: ['plugin_id', value => value],
  tableVersion: ['table_version', value => value],
  cached: ['cached', value => (value === true ? 1 : 0)],
  walletInfo: ['wallet_info', toJson],
  name: ['name', value => value],
  fiatCode: ['fiat_code', value => value],
  enabledTokenIds: ['enabled_token_ids', toJson],
  otherMethodNames: ['other_method_names', toJson],
  stakingStatus: ['staking_status', toJson],
  walletState: ['wallet_state', toJson],
  metaMirrored: ['meta_mirrored', value => (value === true ? 1 : 0)]
}

function toJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}

/** The chain's own asset is `null` in the API and `''` in a key column. */
function toTokenKey(tokenId: string | null): string {
  return tokenId ?? ''
}

/**
 * Inserts a wallet row, or updates the columns passed on the one there.
 *
 * `prefix` is written only when the row is new -- an existing row keeps the
 * prefix its tables are already named with.
 */
export function walletRowStatement(
  walletId: string,
  prefix: string,
  columns: WalletRowColumns
): EdgeSqlStatement {
  const names = ['wallet_id', 'prefix']
  const params: EdgeSqlValue[] = [walletId, prefix]
  const updates: string[] = []

  for (const key of Object.keys(columns) as Array<keyof WalletRowColumns>) {
    const value = columns[key]
    if (value === undefined) continue
    const [name, encode] = walletColumns[key] as [
      string,
      (value: unknown) => EdgeSqlValue
    ]
    names.push(name)
    params.push(encode(value))
    updates.push(`${name} = excluded.${name}`)
  }

  const conflict =
    updates.length === 0 ? 'DO NOTHING' : `DO UPDATE SET ${updates.join(', ')}`
  return {
    sql: `INSERT INTO wallet (${names.join(', ')})
          VALUES (${names.map(() => '?').join(', ')})
          ON CONFLICT (wallet_id) ${conflict}`,
    params
  }
}

/**
 * Each wallet's table prefix, allocating one for a wallet that has no row.
 *
 * New prefixes are unique against the rows already there and against each
 * other, so one batch can create several rows at once.
 */
export async function resolveWalletPrefixes(
  driver: EdgeSqlDriver,
  walletIds: string[]
): Promise<Map<string, string>> {
  const rows = await driver.query<{ wallet_id: string; prefix: string }>(
    'SELECT wallet_id, prefix FROM wallet'
  )
  const out = new Map<string, string>()
  const taken: string[] = []
  for (const row of rows) {
    out.set(row.wallet_id, row.prefix)
    taken.push(row.prefix)
  }
  for (const walletId of walletIds) {
    if (out.has(walletId)) continue
    const prefix = walletTablePrefix(walletId, taken)
    out.set(walletId, prefix)
    taken.push(prefix)
  }
  return out
}

/** Writes the columns passed on one wallet row, creating the row if needed. */
export async function upsertWalletRow(
  driver: EdgeSqlDriver,
  walletId: string,
  columns: WalletRowColumns
): Promise<string> {
  const prefix = (await resolveWalletPrefixes(driver, [walletId])).get(
    walletId
  ) as string
  await driver.exec([walletRowStatement(walletId, prefix, columns)])
  return prefix
}

// ---------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------

/** One wallet's complete boot state, which is what makes a row `cached`. */
export interface WalletCacheRow {
  walletId: string
  pluginId: string | null
  walletInfo: EdgeWalletInfo
  name: string | null
  fiatCurrencyCode: string
  enabledTokenIds: string[]
  otherMethodNames: string[]
  stakingStatus?: EdgeStakingStatus
}

/**
 * The statement that makes a wallet row seedable.
 *
 * `cached` is set in the same statement that writes every column a seed
 * reads, so a row is never seedable with a column missing.
 */
export function walletCacheStatement(
  prefix: string,
  row: WalletCacheRow
): EdgeSqlStatement {
  return walletRowStatement(row.walletId, prefix, {
    pluginId: row.pluginId,
    cached: true,
    walletInfo: row.walletInfo,
    name: row.name,
    fiatCode: row.fiatCurrencyCode,
    enabledTokenIds: row.enabledTokenIds,
    otherMethodNames: row.otherMethodNames,
    stakingStatus: row.stakingStatus ?? null
  })
}

/**
 * Writes balances for one wallet: an amount upserts that token's row, and
 * `null` deletes it. Tokens not named are left alone.
 */
export function balanceStatements(
  walletId: string,
  balances: Iterable<[string | null, string | null]>
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = []
  for (const [tokenId, nativeAmount] of balances) {
    const tokenKey = toTokenKey(tokenId)
    out.push(
      nativeAmount == null
        ? {
            sql: 'DELETE FROM wallet_balance WHERE wallet_id = ? AND token_id = ?',
            params: [walletId, tokenKey]
          }
        : {
            sql: `INSERT INTO wallet_balance (wallet_id, token_id, native_amount)
                  VALUES (?, ?, ?)
                  ON CONFLICT (wallet_id, token_id) DO UPDATE SET
                    native_amount = excluded.native_amount`,
            params: [walletId, tokenKey, nativeAmount]
          }
    )
  }
  return out
}

/**
 * Replaces one asset's address list, keeping its order.
 *
 * A list is replaced whole rather than diffed: it is a handful of rows, and
 * its order is the contract, so a shorter list must lose the rows it dropped.
 * `null` removes the asset's list.
 */
export function addressStatements(
  walletId: string,
  tokenIdKey: string,
  addresses: EdgeAddress[] | null
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = [
    {
      sql: 'DELETE FROM wallet_address WHERE wallet_id = ? AND token_id = ?',
      params: [walletId, tokenIdKey]
    }
  ]
  if (addresses == null) return out
  addresses.forEach((address, ordinal) => {
    out.push({
      sql: `INSERT INTO wallet_address
              (wallet_id, token_id, ordinal, address_type, public_address)
            VALUES (?, ?, ?, ?, ?)`,
      params: [
        walletId,
        tokenIdKey,
        ordinal,
        address.addressType,
        address.publicAddress
      ]
    })
  })
  return out
}

/**
 * Writes one custom token, or removes it with `null`.
 *
 * Removal clears the flag and the custom columns rather than deleting the
 * row, because the same row may be the token's materialization entry, which
 * fiat amounts are computed from.
 */
export function customTokenStatement(
  pluginId: string,
  tokenId: string,
  token: EdgeToken | null
): EdgeSqlStatement {
  if (token == null) {
    return {
      sql: `UPDATE token SET
              is_custom = 0,
              display_name = NULL,
              denominations = NULL,
              network_location = NULL
            WHERE plugin_id = ? AND token_id = ?`,
      params: [pluginId, tokenId]
    }
  }
  return {
    sql: `INSERT INTO token
            (plugin_id, token_id, currency_code, multiplier,
             display_name, denominations, network_location, is_custom)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT (plugin_id, token_id) DO UPDATE SET
            currency_code = excluded.currency_code,
            multiplier = excluded.multiplier,
            display_name = excluded.display_name,
            denominations = excluded.denominations,
            network_location = excluded.network_location,
            is_custom = 1`,
    params: [
      pluginId,
      tokenId,
      token.currencyCode,
      token.denominations[0]?.multiplier ?? '1',
      token.displayName,
      JSON.stringify(token.denominations),
      toJson(token.networkLocation)
    ]
  }
}

/** The account settings the boot state carries, as `setting` rows. */
export interface AccountSettingsRow {
  configOtherMethodNames?: EdgePluginMap<string[]>
  legacyWallets?: boolean
}

const settingKeys = {
  configOtherMethodNames: 'configOtherMethodNames',
  legacyWallets: 'legacyWallets'
}

export function accountSettingsStatements(
  settings: AccountSettingsRow
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = []
  for (const key of Object.keys(settings) as Array<keyof AccountSettingsRow>) {
    const value = settings[key]
    if (value === undefined) continue
    out.push({
      sql: `INSERT INTO setting (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      params: [settingKeys[key], JSON.stringify(value)]
    })
  }
  return out
}

export async function saveWalletRows(
  driver: EdgeSqlDriver,
  rows: WalletCacheRow[]
): Promise<void> {
  if (rows.length === 0) return
  const prefixes = await resolveWalletPrefixes(
    driver,
    rows.map(row => row.walletId)
  )
  await driver.batch(
    rows.map(row =>
      walletCacheStatement(prefixes.get(row.walletId) as string, row)
    )
  )
}

export async function saveWalletBalances(
  driver: EdgeSqlDriver,
  walletId: string,
  balances: EdgeBalanceMap | Map<string | null, string | null>
): Promise<void> {
  const statements = balanceStatements(walletId, balances.entries())
  if (statements.length > 0) await driver.batch(statements)
}

export async function saveWalletAddresses(
  driver: EdgeSqlDriver,
  walletId: string,
  tokenIdKey: string,
  addresses: EdgeAddress[] | null
): Promise<void> {
  await driver.batch(addressStatements(walletId, tokenIdKey, addresses))
}

export async function saveCustomTokens(
  driver: EdgeSqlDriver,
  pluginId: string,
  tokens: EdgeTokenMap
): Promise<void> {
  const statements = Object.keys(tokens).map(tokenId =>
    customTokenStatement(pluginId, tokenId, tokens[tokenId])
  )
  if (statements.length > 0) await driver.batch(statements)
}

export async function removeCustomToken(
  driver: EdgeSqlDriver,
  pluginId: string,
  tokenId: string
): Promise<void> {
  await driver.exec([customTokenStatement(pluginId, tokenId, null)])
}

export async function saveAccountSettings(
  driver: EdgeSqlDriver,
  settings: AccountSettingsRow
): Promise<void> {
  const statements = accountSettingsStatements(settings)
  if (statements.length > 0) await driver.batch(statements)
}

// ---------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------

/**
 * Whether the database holds a wallet cache at all.
 *
 * This is the one question the import asks of storage before touching a
 * file, and the one a boot asks before calling itself warm.
 */
export async function hasWalletCache(driver: EdgeSqlDriver): Promise<boolean> {
  const rows = await driver.query(
    'SELECT 1 FROM wallet WHERE cached = 1 LIMIT 1'
  )
  return rows.length > 0
}

const asWalletInfo: Cleaner<EdgeWalletInfo> = asObject({
  id: asString,
  keys: asJsonObject,
  type: asString
})

const asStringList = asArray(asString)

/**
 * A JSON column read back through its cleaner.
 *
 * SQLite refuses malformed JSON at write time, so what arrives here parses;
 * the cleaner is what refuses a well-formed value of the wrong shape.
 */
function fromJson<T>(cleaner: Cleaner<T>, text: string | null): T | undefined {
  if (text == null) return undefined
  return asMaybe(cleaner)(JSON.parse(text))
}

/**
 * A cleaned value with its absent optional fields left absent.
 *
 * An optional cleaner writes the key with `undefined`, and that is not the
 * same as no key wherever the value is spread: `getAllWalletInfos` spreads a
 * wallet state over defaults that include `sortIndex`, so a present-but-
 * undefined `sortIndex` would erase the default and scramble the wallet
 * order. What comes back from here has exactly the keys that were written.
 */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as unknown as T
  if (value == null || typeof value !== 'object' || value instanceof Date) {
    return value
  }
  const out: any = {}
  for (const key of Object.keys(value)) {
    const item = (value as any)[key]
    if (item !== undefined) out[key] = withoutUndefined(item)
  }
  return out
}

interface SeedRow {
  wallet_id: string
  wallet_info: string | null
  name: string | null
  fiat_code: string | null
  enabled_token_ids: string | null
  other_method_names: string | null
  staking_status: string | null
  balances: string
  addresses: string
}

/**
 * The seeds for every cached wallet, or for the ones named.
 *
 * One query for the whole account. Balances and addresses come back as JSON
 * aggregates beside their wallet rather than as joined rows, because a join
 * would multiply every balance by every address.
 *
 * A row whose columns no longer clean is left out, and that wallet boots
 * cold: a seed is only ever a head start.
 */
export async function readWalletSeeds(
  driver: EdgeSqlDriver,
  walletIds?: string[]
): Promise<{ [walletId: string]: WalletCacheSeed }> {
  const filter =
    walletIds == null
      ? ''
      : `AND w.wallet_id IN (${walletIds.map(() => '?').join(', ')})`
  if (walletIds != null && walletIds.length === 0) return {}

  const rows = await driver.query<SeedRow>(
    `SELECT
       w.wallet_id, w.wallet_info, w.name, w.fiat_code,
       w.enabled_token_ids, w.other_method_names, w.staking_status,
       (SELECT json_group_array(json_array(b.token_id, b.native_amount))
          FROM wallet_balance b WHERE b.wallet_id = w.wallet_id) AS balances,
       (SELECT json_group_array(
                 json_array(a.token_id, a.ordinal, a.address_type, a.public_address))
          FROM wallet_address a WHERE a.wallet_id = w.wallet_id) AS addresses
     FROM wallet w
     WHERE w.cached = 1 ${filter}`,
    walletIds ?? []
  )

  const out: { [walletId: string]: WalletCacheSeed } = {}
  for (const row of rows) {
    const seed = toSeed(row)
    if (seed != null) out[row.wallet_id] = seed
  }
  return out
}

function toSeed(row: SeedRow): WalletCacheSeed | undefined {
  const publicWalletInfo = fromJson(asWalletInfo, row.wallet_info)
  const enabledTokenIds = fromJson(asStringList, row.enabled_token_ids)
  const otherMethodNames = fromJson(asStringList, row.other_method_names)
  if (
    publicWalletInfo == null ||
    row.fiat_code == null ||
    enabledTokenIds == null ||
    otherMethodNames == null
  ) {
    return
  }

  const balanceMap: EdgeBalanceMap = new Map()
  const balances: Array<[string, string]> = JSON.parse(row.balances)
  for (const [tokenId, nativeAmount] of balances) {
    balanceMap.set(tokenId === '' ? null : tokenId, nativeAmount)
  }

  // Aggregate order is not a contract, so the order is rebuilt from the
  // column that holds it:
  const addresses: { [tokenIdKey: string]: EdgeAddress[] } = {}
  const addressRows: Array<[string, number, string, string]> = JSON.parse(
    row.addresses
  )
  addressRows.sort((a, b) => a[1] - b[1])
  for (const [tokenIdKey, , addressType, publicAddress] of addressRows) {
    const list = addresses[tokenIdKey] ?? (addresses[tokenIdKey] = [])
    list.push({ addressType, publicAddress })
  }

  const out: WalletCacheSeed = {
    addresses,
    balanceMap,
    enabledTokenIds,
    fiatCurrencyCode: row.fiat_code,
    name: row.name,
    otherMethodNames,
    publicWalletInfo
  }
  const stakingStatus = fromJson(asCachedStakingStatus, row.staking_status)
  if (stakingStatus != null) out.stakingStatus = withoutUndefined(stakingStatus)
  return out
}

/**
 * The account-level boot state: custom tokens, settings, and every wallet
 * state the account holds.
 *
 * Wallet states come from every row that has one, cached or not. An archived
 * wallet, or one whose plugin is gone, has a state and no seed -- and
 * `ACCOUNT_CACHE_LOADED` replaces the account's wallet states wholesale, so a
 * state left out here would be a state lost for the session.
 */
export async function readAccountSeed(
  driver: EdgeSqlDriver
): Promise<AccountSeed> {
  const tokenRows = await driver.query<{
    plugin_id: string
    token_id: string
    currency_code: string
    display_name: string | null
    denominations: string | null
    network_location: string | null
  }>(
    `SELECT plugin_id, token_id, currency_code, display_name,
            denominations, network_location
       FROM token WHERE is_custom = 1`
  )
  const customTokens: EdgePluginMap<EdgeTokenMap> = {}
  for (const row of tokenRows) {
    const token = asMaybe(asEdgeToken)({
      currencyCode: row.currency_code,
      displayName: row.display_name,
      denominations:
        row.denominations == null ? undefined : JSON.parse(row.denominations),
      networkLocation:
        row.network_location == null
          ? undefined
          : JSON.parse(row.network_location)
    })
    if (token == null) continue
    const tokens = customTokens[row.plugin_id] ?? {}
    tokens[row.token_id] = withoutUndefined(token)
    customTokens[row.plugin_id] = tokens
  }

  const stateRows = await driver.query<{
    wallet_id: string
    wallet_state: string
  }>(
    'SELECT wallet_id, wallet_state FROM wallet WHERE wallet_state IS NOT NULL'
  )
  const walletStates: EdgeWalletStates = {}
  for (const row of stateRows) {
    const state = fromJson(asEdgeWalletState, row.wallet_state)
    if (state != null) walletStates[row.wallet_id] = withoutUndefined(state)
  }

  const settingRows = await driver.query<{ key: string; value: string }>(
    `SELECT key, value FROM setting
      WHERE key IN ('configOtherMethodNames', 'legacyWallets')`
  )
  const settings = new Map(settingRows.map(row => [row.key, row.value]))
  const configOtherMethodNames =
    fromJson(
      asObject(asStringList),
      settings.get(settingKeys.configOtherMethodNames) ?? null
    ) ?? {}
  const legacyWallets =
    fromJson(asBoolean, settings.get(settingKeys.legacyWallets) ?? null) ??
    false

  return { customTokens, configOtherMethodNames, legacyWallets, walletStates }
}
