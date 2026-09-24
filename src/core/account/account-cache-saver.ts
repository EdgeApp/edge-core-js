import {
  EdgeAddress,
  EdgeBalanceMap,
  EdgePluginMap,
  EdgeStakingStatus,
  EdgeToken,
  EdgeWalletInfo,
  EdgeWalletState
} from '../../types/types'
import { CurrencyWalletState } from '../currency/wallet/currency-wallet-reducer'
import { EdgeSqlDriver, EdgeSqlStatement } from '../db/db-driver'
import {
  accountSettingsStatements,
  addressStatements,
  balanceStatements,
  customTokenStatement,
  resolveWalletPrefixes,
  walletCacheStatement,
  walletRowStatement
} from '../db/wallet-store'
import { maybeFindCurrencyPluginId } from '../plugins/plugins-selectors'
import { AccountInput } from './account-pixie'

/**
 * Keeps the account's boot state in the database.
 *
 * Every pass diffs the Redux state it last wrote against the state now, and
 * lands only the rows that changed, in one transaction. A balance that moved
 * is one row; a wallet nobody touched is no statement at all. The throttle is
 * still here, but only to batch bridge round trips -- there is no longer any
 * write amplification for it to bound.
 */

export const accountCacheSaverConfig = {
  throttleMs: 5000,
  /** A write slower than this logs at `warn` instead of `info`. */
  slowWriteMs: 5000,
  /** Test hook: told how many statements each committed pass carried. */
  onSave: undefined as ((statementCount: number) => void) | undefined
}

export interface AccountCacheSaver {
  /** Call on every props change; arms the throttle when something moved. */
  update: () => void
  /** Stops writing for good, including a write the throttle has armed. */
  destroy: () => void
}

/** The wallet fields last written, by reference. Redux slices are immutable. */
interface WrittenWallet {
  addresses: { [tokenIdKey: string]: EdgeAddress[] }
  balanceMap: EdgeBalanceMap
  enabledTokenIds: string[]
  fiat: string
  name: string | null
  otherMethodNames: string[]
  publicWalletInfo: EdgeWalletInfo
  stakingStatus: EdgeStakingStatus
}

/** Stands in for a row the database holds that this session has not seen. */
const unseen = {}

export function makeAccountCacheSaver(
  input: AccountInput,
  getDriver: () => EdgeSqlDriver
): AccountCacheSaver {
  let destroyed = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let chain: Promise<void> = Promise.resolve()

  // What the database holds, as of the last committed pass. `undefined`
  // until the first pass reads what an earlier session left behind:
  let written:
    | {
        wallets: Map<string, WrittenWallet>
        cachedIds: Set<string>
        walletStates: Map<string, EdgeWalletState | typeof unseen>
        customTokens: Map<string, EdgeToken | typeof unseen>
        settings: string
      }
    | undefined

  // The update-time snapshot, so an unchanged Redux tick costs a reference
  // scan rather than a pass:
  let lastSeen: unknown[] | undefined
  let pendingSeen: unknown[] = []

  function snapshot(): unknown[] {
    const { accountState, state } = input.props
    const out: unknown[] = [
      accountState.currencyWalletIds,
      accountState.customTokens,
      accountState.legacyWalletInfos,
      accountState.walletStates,
      accountState.walletInfos
    ]
    for (const walletId of accountState.activeWalletIds) {
      const walletState = state.currency.wallets[walletId]
      if (walletState == null || !isCacheable(walletState)) {
        out.push(null)
        continue
      }
      out.push(
        walletState.addresses,
        walletState.balanceMap,
        walletState.enabledTokenIds,
        walletState.fiat,
        walletState.name,
        walletState.otherMethodNames,
        walletState.publicWalletInfo,
        walletState.stakingStatus
      )
    }
    return out
  }

  async function doSave(): Promise<void> {
    const { accountId, accountState, state } = input.props

    // Never write after logout. The destroy flag is what makes this
    // reliable: redux-pixies serves a destroyed pixie its last props, so
    // the state below would still report the account as present:
    if (destroyed) return
    if (state.accounts[accountId] == null) return

    const seen = pendingSeen
    try {
      const driver = getDriver()
      const before = written ?? (await readWritten(driver))
      const next = {
        wallets: new Map(before.wallets),
        cachedIds: new Set(before.cachedIds),
        walletStates: new Map(before.walletStates),
        customTokens: new Map(before.customTokens),
        settings: before.settings
      }
      const statements: EdgeSqlStatement[] = []

      // Every wallet a statement may create a row for needs its prefix:
      const touched = new Set<string>([
        ...accountState.activeWalletIds,
        ...Object.keys(accountState.walletStates),
        ...before.walletStates.keys()
      ])
      const prefixes = await resolveWalletPrefixes(driver, [...touched])
      const prefixOf = (walletId: string): string =>
        prefixes.get(walletId) as string

      // Wallets:
      for (const walletId of accountState.activeWalletIds) {
        const walletState = state.currency.wallets[walletId]
        if (walletState == null || !isCacheable(walletState)) continue
        const prior = before.wallets.get(walletId)
        statements.push(
          ...walletStatements(walletId, prefixOf(walletId), walletState, prior)
        )
        next.wallets.set(walletId, writtenOf(walletState))
        next.cachedIds.add(walletId)
      }

      // A cached wallet the account no longer has, or has deleted, stops
      // seeding. Its state stays; only its boot state goes:
      for (const walletId of before.cachedIds) {
        const gone =
          accountState.walletInfos[walletId] == null ||
          accountState.walletStates[walletId]?.deleted === true
        if (!gone) continue
        statements.push(
          walletRowStatement(walletId, prefixOf(walletId), { cached: false }),
          {
            sql: 'DELETE FROM wallet_balance WHERE wallet_id = ?',
            params: [walletId]
          },
          {
            sql: 'DELETE FROM wallet_address WHERE wallet_id = ?',
            params: [walletId]
          }
        )
        next.wallets.delete(walletId)
        next.cachedIds.delete(walletId)
      }

      // Wallet states. A wallet the account holds no state for gets NULL,
      // never an invented entry, because the account spreads a state over
      // defaults and an invented one would erase them:
      const stateIds = new Set([
        ...before.walletStates.keys(),
        ...Object.keys(accountState.walletStates)
      ])
      for (const walletId of stateIds) {
        const walletState = accountState.walletStates[walletId]
        if (walletState === before.walletStates.get(walletId)) continue
        const pluginId = walletPluginId(walletId)
        statements.push(
          walletRowStatement(walletId, prefixOf(walletId), {
            ...(pluginId != null ? { pluginId } : {}),
            walletState: walletState ?? null
          })
        )
        if (walletState == null) next.walletStates.delete(walletId)
        else next.walletStates.set(walletId, walletState)
      }

      // Custom tokens:
      const tokenKeys = new Set(before.customTokens.keys())
      for (const pluginId of Object.keys(accountState.customTokens)) {
        for (const tokenId of Object.keys(
          accountState.customTokens[pluginId]
        )) {
          tokenKeys.add(tokenKey(pluginId, tokenId))
        }
      }
      for (const key of tokenKeys) {
        const [pluginId, tokenId] = splitTokenKey(key)
        const token = accountState.customTokens[pluginId]?.[tokenId]
        if (token === before.customTokens.get(key)) continue
        statements.push(customTokenStatement(pluginId, tokenId, token ?? null))
        if (token == null) next.customTokens.delete(key)
        else next.customTokens.set(key, token)
      }

      // Settings:
      const settings = accountSettings()
      const settingsText = JSON.stringify(settings)
      if (settingsText !== before.settings) {
        statements.push(...accountSettingsStatements(settings))
        next.settings = settingsText
      }

      if (statements.length > 0) {
        const startMs = Date.now()
        await driver.batch(statements)

        // The write is this design's whole cost, and it is invisible from
        // the outside. The throttle bounds this to one line per window, but
        // that runs for the whole session, so it ships at `info` and only a
        // slow write earns `warn`:
        const elapsedMs = Date.now() - startMs
        const line = `Wallet cache: wrote ${statements.length} rows in ${elapsedMs}ms`
        if (elapsedMs > accountCacheSaverConfig.slowWriteMs) {
          input.props.log.warn(line)
        } else {
          input.props.log(line)
        }
        accountCacheSaverConfig.onSave?.(statements.length)
      }

      written = next
      lastSeen = seen
      failures = 0
    } catch (error: unknown) {
      if (++failures >= 3) {
        input.props.log.error(
          `Account cache saver giving up after ${failures} failures: ${String(
            error
          )}`
        )
      }
    }
  }

  /** What an earlier session left, so this one can diff against it. */
  async function readWritten(
    driver: EdgeSqlDriver
  ): Promise<NonNullable<typeof written>> {
    const cachedRows = await driver.query<{ wallet_id: string }>(
      'SELECT wallet_id FROM wallet WHERE cached = 1'
    )
    const stateRows = await driver.query<{ wallet_id: string }>(
      'SELECT wallet_id FROM wallet WHERE wallet_state IS NOT NULL'
    )
    const tokenRows = await driver.query<{
      plugin_id: string
      token_id: string
    }>('SELECT plugin_id, token_id FROM token WHERE is_custom = 1')

    const walletStates = new Map<string, typeof unseen>()
    for (const row of stateRows) walletStates.set(row.wallet_id, unseen)
    const customTokens = new Map<string, typeof unseen>()
    for (const row of tokenRows) {
      customTokens.set(tokenKey(row.plugin_id, row.token_id), unseen)
    }

    return {
      wallets: new Map(),
      cachedIds: new Set(cachedRows.map(row => row.wallet_id)),
      walletStates,
      customTokens,
      settings: ''
    }
  }

  function walletPluginId(walletId: string): string | undefined {
    const { accountState, state } = input.props
    const info = accountState.walletInfos[walletId]
    if (info == null) return
    return maybeFindCurrencyPluginId(state.plugins.currency, info.type)
  }

  function accountSettings(): {
    configOtherMethodNames: EdgePluginMap<string[]>
    legacyWallets: boolean
  } {
    const { accountState, state } = input.props

    // Only legacy wallets that actually surface as currency wallets force a
    // cold boot; a legacy repo whose wallet type has no loaded plugin was
    // never visible in the first place:
    const legacyWallets = accountState.legacyWalletInfos.some(info =>
      accountState.currencyWalletIds.includes(info.id)
    )

    // Each plugin's otherMethods names. The plugin list is static for the
    // whole session, so this needs no dirty tracking:
    const configOtherMethodNames: EdgePluginMap<string[]> = {}
    const currency = state.plugins.currency
    for (const pluginId of Object.keys(currency)) {
      const { otherMethods } = currency[pluginId]
      if (otherMethods == null) continue
      const names = Object.keys(otherMethods).filter(
        name => typeof (otherMethods as any)[name] === 'function'
      )
      if (names.length > 0) configOtherMethodNames[pluginId] = names
    }

    return { configOtherMethodNames, legacyWallets }
  }

  return {
    update() {
      const { accountState } = input.props
      if (accountState == null) return
      if (failures >= 3 || timer != null) return

      // Wait until the authoritative files have loaded, so a cold start
      // never caches placeholder values. A database that could not take
      // the import is not one to write to either -- the next login imports
      // again, with nothing lost:
      const {
        customTokensLoaded,
        walletCacheImportFailed,
        walletStatesLoaded
      } = accountState
      if (!customTokensLoaded || !walletStatesLoaded) return
      if (walletCacheImportFailed) return

      const seen = snapshot()
      if (lastSeen != null && sameList(lastSeen, seen)) return
      pendingSeen = seen

      timer = setTimeout(() => {
        timer = undefined
        chain = chain.then(doSave, doSave)
        chain.catch(error => input.props.onError(error))
      }, accountCacheSaverConfig.throttleMs)
    },

    destroy() {
      destroyed = true
      if (timer != null) clearTimeout(timer)
    }
  }
}

/**
 * Whether a wallet has finished loading its authoritative files.
 *
 * A cold start must never cache placeholder values. The token-file flag is
 * the sticky one, so a resync -- which clears `tokenFileLoaded` but keeps
 * the enabled list -- does not freeze the wallet's row for the session.
 */
function isCacheable(walletState: CurrencyWalletState): boolean {
  const { fiatLoaded, nameLoaded, publicWalletInfo, tokenFileEverLoaded } =
    walletState
  return (
    fiatLoaded && nameLoaded && tokenFileEverLoaded && publicWalletInfo != null
  )
}

function writtenOf(walletState: CurrencyWalletState): WrittenWallet {
  return {
    addresses: walletState.addresses,
    balanceMap: walletState.balanceMap,
    enabledTokenIds: walletState.enabledTokenIds,
    fiat: walletState.fiat,
    name: walletState.name,
    otherMethodNames: walletState.otherMethodNames,
    publicWalletInfo: walletState.publicWalletInfo as EdgeWalletInfo,
    stakingStatus: walletState.stakingStatus
  }
}

/**
 * The statements that bring one wallet's rows up to its Redux state.
 *
 * A wallet this session has not written yet is rewritten whole, since there
 * is nothing to diff against. After that, only what moved.
 */
function walletStatements(
  walletId: string,
  prefix: string,
  walletState: CurrencyWalletState,
  prior: WrittenWallet | undefined
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = []

  const rowChanged =
    prior == null ||
    prior.publicWalletInfo !== walletState.publicWalletInfo ||
    prior.name !== walletState.name ||
    prior.fiat !== walletState.fiat ||
    prior.enabledTokenIds !== walletState.enabledTokenIds ||
    prior.otherMethodNames !== walletState.otherMethodNames ||
    prior.stakingStatus !== walletState.stakingStatus
  if (rowChanged) {
    out.push(
      walletCacheStatement(prefix, {
        walletId,
        pluginId: walletState.pluginId,
        walletInfo: walletState.publicWalletInfo as EdgeWalletInfo,
        name: walletState.name,
        fiatCurrencyCode: walletState.fiat,
        enabledTokenIds: walletState.enabledTokenIds,
        otherMethodNames: walletState.otherMethodNames,
        stakingStatus: walletState.stakingStatus
      })
    )
  }

  // Balances:
  if (prior == null) {
    out.push({
      sql: 'DELETE FROM wallet_balance WHERE wallet_id = ?',
      params: [walletId]
    })
    out.push(...balanceStatements(walletId, walletState.balanceMap.entries()))
  } else if (prior.balanceMap !== walletState.balanceMap) {
    const changes: Array<[string | null, string | null]> = []
    for (const [tokenId, amount] of walletState.balanceMap) {
      if (prior.balanceMap.get(tokenId) !== amount) {
        changes.push([tokenId, amount])
      }
    }
    for (const tokenId of prior.balanceMap.keys()) {
      if (!walletState.balanceMap.has(tokenId)) changes.push([tokenId, null])
    }
    out.push(...balanceStatements(walletId, changes))
  }

  // Addresses:
  const { addresses } = walletState
  if (prior == null) {
    out.push({
      sql: 'DELETE FROM wallet_address WHERE wallet_id = ?',
      params: [walletId]
    })
    for (const key of Object.keys(addresses)) {
      out.push(...addressStatements(walletId, key, addresses[key]).slice(1))
    }
  } else if (prior.addresses !== addresses) {
    for (const key of Object.keys(addresses)) {
      if (prior.addresses[key] === addresses[key]) continue
      out.push(...addressStatements(walletId, key, addresses[key]))
    }
    for (const key of Object.keys(prior.addresses)) {
      if (addresses[key] == null) {
        out.push(...addressStatements(walletId, key, null))
      }
    }
  }

  return out
}

function tokenKey(pluginId: string, tokenId: string): string {
  return `${pluginId}\u001f${tokenId}`
}

function splitTokenKey(key: string): [string, string] {
  const at = key.indexOf('\u001f')
  return [key.slice(0, at), key.slice(at + 1)]
}

function sameList(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false
  }
  return true
}
