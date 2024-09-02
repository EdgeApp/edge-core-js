import { asMaybe } from 'cleaners'
import { base16, base64 } from 'rfc4648'

import { wasCreateKeysPayload } from '../../types/server-cleaners'
import {
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyWallet,
  EdgeWalletInfo
} from '../../types/types'
import { encrypt } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { changeWalletStates } from '../account/account-files'
import { waitForCurrencyWallet } from '../currency/currency-selectors'
import {
  findCurrencyPluginId,
  getCurrencyTools
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { AppIdMap, LoginKit, LoginTree, wasEdgeWalletInfo } from './login-types'
import {
  asEdgeStorageKeys,
  createStorageKeys,
  wasEdgeStorageKeys
} from './storage-keys'

/**
 * Returns the first keyInfo with a matching type.
 */
export function findFirstKey(
  keyInfos: EdgeWalletInfo[],
  type: string
): EdgeWalletInfo | undefined {
  return keyInfos.find(info => info.type === type)
}

export function makeAccountType(appId: string): string {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

/**
 * Assembles the key metadata structure that is encrypted within a keyBox.
 * @param idKey Used to derive the wallet id. It's usually `dataKey`.
 */
export function makeKeyInfo(
  type: string,
  keys: object,
  idKey?: Uint8Array
): EdgeWalletInfo {
  const hash = hmacSha256(
    utf8.parse(type),
    idKey ?? asEdgeStorageKeys(keys).dataKey
  )
  return { id: base64.stringify(hash), type, keys }
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit(
  ai: ApiInput,
  login: LoginTree,
  keyInfos: EdgeWalletInfo[]
): LoginKit {
  // For crash errors:
  ai.props.log.breadcrumb('makeKeysKit', {})

  const { io } = ai.props
  const keyBoxes = keyInfos.map(info =>
    encrypt(
      io,
      utf8.parse(JSON.stringify(wasEdgeWalletInfo(info))),
      login.loginKey
    )
  )

  const newSyncKeys: string[] = []
  for (const info of keyInfos) {
    const storageKeys = asMaybe(asEdgeStorageKeys)(info.keys)
    if (storageKeys == null) continue
    newSyncKeys.push(base16.stringify(storageKeys.syncKey).toLowerCase())
  }

  return {
    serverPath: '/v2/login/keys',
    server: wasCreateKeysPayload({ keyBoxes, newSyncKeys }),
    stash: { keyBoxes },
    login: { keyInfos },
    loginId: login.loginId
  }
}

/**
 * Flattens an array of key structures, removing duplicates.
 */
export function mergeKeyInfos(keyInfos: EdgeWalletInfo[]): EdgeWalletInfo[] {
  const out: EdgeWalletInfo[] = []
  const ids: { [id: string]: number } = {} // Maps ID's to output array indexes

  for (const keyInfo of keyInfos) {
    const { id, type, keys } = keyInfo
    if (id == null || base64.parse(id).length !== 32) {
      throw new Error(`Key integrity violation: invalid id ${id}`)
    }

    if (ids[id] != null) {
      // We have already seen this id, so check for conflicts:
      const old = out[ids[id]]
      if (old.type !== type) {
        throw new Error(
          `Key integrity violation for ${id}: type ${type} does not match ${old.type}`
        )
      }
      for (const key of Object.keys(keys)) {
        if (old.keys[key] != null && old.keys[key] !== keys[key]) {
          throw new Error(
            `Key integrity violation for ${id}: ${key} keys do not match`
          )
        }
      }

      // Do the update:
      out[ids[id]] = { id, type, keys: { ...old.keys, ...keys } }
    } else {
      // We haven't seen this id, so insert it:
      ids[id] = out.length
      out.push(keyInfo)
    }
  }

  return out
}

/**
 * Returns all the wallet infos accessible from this login object,
 * as well as a map showing which wallets are in which applications.
 */
export function getAllWalletInfos(
  login: LoginTree,
  legacyWalletInfos: EdgeWalletInfo[] = []
): {
  appIdMap: AppIdMap
  walletInfos: EdgeWalletInfo[]
} {
  const appIdMap: AppIdMap = {}
  const walletInfos: EdgeWalletInfo[] = []

  // Add the legacy wallets first:
  for (const info of legacyWalletInfos) {
    walletInfos.push(info)
    if (appIdMap[info.id] == null) appIdMap[info.id] = [login.appId]
    else appIdMap[info.id].push(login.appId)
  }

  function getAllWalletInfosLoop(login: LoginTree): void {
    // Add our own walletInfos:
    for (const info of login.keyInfos) {
      walletInfos.push(info)
      if (appIdMap[info.id] == null) appIdMap[info.id] = [login.appId]
      else appIdMap[info.id].push(login.appId)
    }

    // Add our children's walletInfos:
    for (const child of login.children) {
      getAllWalletInfosLoop(child)
    }
  }
  getAllWalletInfosLoop(login)

  return { appIdMap, walletInfos: mergeKeyInfos(walletInfos) }
}

/**
 * Upgrades legacy wallet info structures into the new format.
 *
 * Wallets normally have `wallet:pluginId` as their type,
 * but some legacy wallets also put format information into the wallet type.
 * This routine moves the information out of the wallet type into the keys.
 *
 * It also provides some other default values as a historical accident,
 * but the bitcoin plugin can just provide its own fallback values if
 * `format` or `coinType` are missing. Please don't make the problem worse
 * by adding more code here!
 */
export function fixWalletInfo(walletInfo: EdgeWalletInfo): EdgeWalletInfo {
  const { id, keys, type } = walletInfo

  // Wallet types we need to fix:
  const defaults: { [type: string]: object } = {
    // BTC:
    'wallet:bitcoin-bip44': { format: 'bip44', coinType: 0 },
    'wallet:bitcoin-bip49': { format: 'bip49', coinType: 0 },
    // BCH:
    'wallet:bitcoincash-bip32': { format: 'bip32' },
    'wallet:bitcoincash-bip44': { format: 'bip44', coinType: 145 },
    // BCH testnet:
    'wallet:bitcoincash-bip44-testnet': { format: 'bip44', coinType: 1 },
    // BTC testnet:
    'wallet:bitcoin-bip44-testnet': { format: 'bip44', coinType: 1 },
    'wallet:bitcoin-bip49-testnet': { format: 'bip49', coinType: 1 },
    // DASH:
    'wallet:dash-bip44': { format: 'bip44', coinType: 5 },
    // DOGE:
    'wallet:dogecoin-bip44': { format: 'bip44', coinType: 3 },
    // LTC:
    'wallet:litecoin-bip44': { format: 'bip44', coinType: 2 },
    'wallet:litecoin-bip49': { format: 'bip49', coinType: 2 },
    // FTC:
    'wallet:feathercoin-bip49': { format: 'bip49', coinType: 8 },
    'wallet:feathercoin-bip44': { format: 'bip44', coinType: 8 },
    // QTUM:
    'wallet:qtum-bip44': { format: 'bip44', coinType: 2301 },
    // UFO:
    'wallet:ufo-bip49': { format: 'bip49', coinType: 202 },
    'wallet:ufo-bip84': { format: 'bip84', coinType: 202 },
    // XZC:
    'wallet:zcoin-bip44': { format: 'bip44', coinType: 136 },

    // The plugin itself could handle these lines, but they are here
    // as a historical accident. Please don't add more:
    'wallet:bitcoin-testnet': { format: 'bip32' },
    'wallet:bitcoin': { format: 'bip32' },
    'wallet:bitcoincash-testnet': { format: 'bip32' },
    'wallet:litecoin': { format: 'bip32', coinType: 2 },
    'wallet:zcoin': { format: 'bip32', coinType: 136 }
  }

  if (defaults[type] != null) {
    return {
      id,
      keys: { ...defaults[type], ...keys },
      type: type.replace(/-bip[0-9]+/, '')
    }
  }

  return walletInfo
}

export async function makeCurrencyWalletKeys(
  ai: ApiInput,
  walletType: string,
  opts: EdgeCreateCurrencyWalletOptions
): Promise<EdgeWalletInfo> {
  const { importText, keyOptions, keys } = opts

  // Helper function to bundle up the keys:
  function finalizeKeys(newKeys: object, imported?: boolean): EdgeWalletInfo {
    if (imported != null) newKeys = { ...newKeys, imported }
    return fixWalletInfo(
      makeKeyInfo(walletType, {
        ...wasEdgeStorageKeys(createStorageKeys(ai)),
        ...newKeys
      })
    )
  }

  // If we have raw keys, just return those:
  if (keys != null) return finalizeKeys(keys)

  // Grab the currency tools:
  const pluginId = findCurrencyPluginId(
    ai.props.state.plugins.currency,
    walletType
  )
  const tools = await getCurrencyTools(ai, pluginId)

  // If we have text to import, use that:
  if (importText != null) {
    if (tools.importPrivateKey == null) {
      throw new Error('This wallet does not support importing keys')
    }
    return finalizeKeys(
      await tools.importPrivateKey(importText, keyOptions),
      true
    )
  }

  // Derive fresh keys:
  return finalizeKeys(
    await tools.createPrivateKey(walletType, keyOptions),
    false
  )
}

export async function finishWalletCreation(
  ai: ApiInput,
  accountId: string,
  walletId: string,
  opts: EdgeCreateCurrencyWalletOptions
): Promise<EdgeCurrencyWallet> {
  const { enabledTokenIds, fiatCurrencyCode, migratedFromWalletId, name } = opts
  const wallet = await waitForCurrencyWallet(ai, walletId)

  // Write ancillary files to disk:
  if (migratedFromWalletId != null) {
    await changeWalletStates(ai, accountId, {
      [walletId]: { migratedFromWalletId }
    })
  }
  if (name != null) {
    await wallet.renameWallet(name)
  }
  if (fiatCurrencyCode != null) {
    await wallet.setFiatCurrencyCode(fiatCurrencyCode)
  }
  if (enabledTokenIds != null && enabledTokenIds.length > 0) {
    await wallet.changeEnabledTokenIds(enabledTokenIds)
  }

  return wallet
}
