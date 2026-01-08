import { asMaybe } from 'cleaners'
import { base16, base64 } from 'rfc4648'

import { wasCreateKeysPayload } from '../../types/server-cleaners'
import {
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyWallet,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../types/types'
import { decrypt, decryptText, encrypt } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { changeWalletStates } from '../account/account-files'
import { waitForCurrencyWallet } from '../currency/currency-selectors'
import {
  findCurrencyPluginId,
  getCurrencyTools
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { getChildStash } from './login-selectors'
import { LoginStash } from './login-stash'
import {
  asEdgeWalletInfo,
  LoginKit,
  SessionKey,
  wasEdgeWalletInfo
} from './login-types'
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
 * @param allowExisting True if the sync keys were derived deterministically,
 * which implies that duplicate sync keys on the server are not errors,
 * but leftovers from an earlier failed splitting attempt.
 */
export function makeKeysKit(
  ai: ApiInput,
  sessionKey: SessionKey,
  keyInfos: EdgeWalletInfo[],
  allowExisting: boolean = false
): LoginKit {
  // For crash errors:
  ai.props.log.breadcrumb('makeKeysKit', {})

  const { io } = ai.props
  const keyBoxes = keyInfos.map(info => ({
    created: new Date(),
    ...encrypt(
      io,
      utf8.parse(JSON.stringify(wasEdgeWalletInfo(info))),
      sessionKey.loginKey
    )
  }))

  const newSyncKeys: string[] = []
  for (const info of keyInfos) {
    const storageKeys = asMaybe(asEdgeStorageKeys)(info.keys)
    if (storageKeys == null) continue
    newSyncKeys.push(base16.stringify(storageKeys.syncKey).toLowerCase())
  }

  return {
    loginId: sessionKey.loginId,
    server: wasCreateKeysPayload({ allowExisting, keyBoxes, newSyncKeys }),
    serverPath: '/v2/login/keys',
    stash: { keyBoxes }
  }
}

/**
 * Flattens an array of key structures, removing duplicates.
 */
export function mergeKeyInfos(keyInfos: EdgeWalletInfo[]): EdgeWalletInfo[] {
  const out: EdgeWalletInfo[] = []
  const ids = new Map<string, number>() // Maps ID's to output array indexes

  for (const keyInfo of keyInfos) {
    const { id, keys, type } = keyInfo
    if (id == null || base64.parse(id).length !== 32) {
      throw new Error(`Key integrity violation: invalid id ${id}`)
    }

    const index = ids.get(id)
    if (index != null) {
      // We have already seen this id, so check for conflicts:
      const old = out[index]
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
      out[index] = { id, keys: { ...old.keys, ...keys }, type }
    } else {
      // We haven't seen this id, so insert it:
      ids.set(id, out.length)
      out.push(keyInfo)
    }
  }

  return out
}

/**
 * Decrypts the private keys contained in a login.
 */
export function decryptKeyInfos(
  stash: LoginStash,
  loginKey: Uint8Array,
  keyDates = new Map<string, Date>()
): EdgeWalletInfo[] {
  const { appId, keyBoxes = [] } = stash

  const legacyKeys: EdgeWalletInfo[] = []

  // BitID wallet:
  const { mnemonicBox, rootKeyBox } = stash
  if (mnemonicBox != null && rootKeyBox != null) {
    const rootKey = decrypt(rootKeyBox, loginKey)
    const infoKey = hmacSha256(rootKey, utf8.parse('infoKey'))
    const keys = {
      mnemonic: decryptText(mnemonicBox, infoKey),
      rootKey: base64.stringify(rootKey)
    }
    legacyKeys.push(makeKeyInfo('wallet:bitid', keys, rootKey))
  }

  // Account settings:
  if (stash.syncKeyBox != null) {
    const syncKey = decrypt(stash.syncKeyBox, loginKey)
    const type = makeAccountType(appId)
    const keys = wasEdgeStorageKeys({ dataKey: loginKey, syncKey })
    legacyKeys.push(makeKeyInfo(type, keys, loginKey))
  }

  // Keys:
  const keyInfos = keyBoxes.map(box => {
    const keys = asEdgeWalletInfo(JSON.parse(decryptText(box, loginKey)))
    const created = mergeKeyDate(box.created, keyDates.get(keys.id))
    if (created != null) keyDates.set(keys.id, created)
    return keys
  })
  return mergeKeyInfos([...legacyKeys, ...keyInfos]).map(walletInfo =>
    fixWalletInfo(walletInfo)
  )
}

/**
 * Returns all the wallet infos accessible from this login object.
 */
export function decryptAllWalletInfos(
  stashTree: LoginStash,
  sessionKey: SessionKey,
  legacyWalletInfos: EdgeWalletInfo[],
  walletStates: EdgeWalletStates
): EdgeWalletInfoFull[] {
  // Maps from walletId's to appId's:
  const dates = new Map<string, Date>()
  const appIdMap = new Map<string, string[]>()
  const walletInfos: EdgeWalletInfo[] = [...legacyWalletInfos]

  // Navigate to the starting node:
  const stash = getChildStash(stashTree, sessionKey.loginId)

  // Add the legacy wallets first:
  for (const info of legacyWalletInfos) {
    walletInfos.push(info)

    const appIds = appIdMap.get(info.id)
    if (appIds != null) appIds.push(stash.appId)
    else appIdMap.set(info.id, [stash.appId])
  }

  function getAllWalletInfosLoop(
    stash: LoginStash,
    loginKey: Uint8Array
  ): void {
    // Add our own walletInfos:
    const keyInfos = decryptKeyInfos(stash, loginKey, dates)
    for (const info of keyInfos) {
      walletInfos.push(info)

      const appIds = appIdMap.get(info.id)
      if (appIds != null) appIds.push(stash.appId)
      else appIdMap.set(info.id, [stash.appId])
    }

    // Add our children's walletInfos:
    for (const child of stash.children ?? []) {
      if (child.parentBox == null) continue
      getAllWalletInfosLoop(child, decrypt(child.parentBox, loginKey))
    }
  }
  getAllWalletInfosLoop(stash, sessionKey.loginKey)

  return mergeKeyInfos(walletInfos).map(info => {
    return {
      appId: getLast(appIdMap.get(info.id) ?? []),
      appIds: appIdMap.get(info.id) ?? [],

      // Defaults to be overwritten:
      archived: false,
      created: dates.get(info.id),
      deleted: false,
      hidden: false,
      sortIndex: walletInfos.length,

      // Copy the `imported` field from the raw keys if it exists
      imported: info.keys.imported,

      // Actual info:
      ...walletStates[info.id],
      ...info
    }
  })
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

function getLast<T>(array: T[]): T {
  return array[array.length - 1]
}

/**
 * Returns the earliest date, or undefined if neither date exists.
 */
function mergeKeyDate(
  a: Date | undefined,
  b: Date | undefined
): Date | undefined {
  if (a == null) return b
  if (b == null) return a
  return new Date(Math.min(a.valueOf(), b.valueOf()))
}
