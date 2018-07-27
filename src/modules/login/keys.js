// @flow

import type { EdgeWalletInfo } from '../../edge-core-index.js'
import { encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { base16, base64, utf8 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import type {
  AppIdMap,
  LoginKit,
  LoginTree,
  StorageKeys,
  StorageWalletInfo
} from './login-types.js'

/**
 * Returns the first keyInfo with a matching type.
 */
export function findFirstKey (keyInfos: Array<EdgeWalletInfo>, type: string) {
  return keyInfos.find(info => info.type === type)
}

export function makeAccountType (appId: string) {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

/**
 * Assembles the key metadata structure that is encrypted within a keyBox.
 * @param idKey Used to derive the wallet id. It's usually `dataKey`.
 */
export function makeKeyInfo (type: string, keys: {}, idKey: Uint8Array) {
  return {
    id: base64.stringify(hmacSha256(utf8.parse(type), idKey)),
    type,
    keys
  }
}

/**
 * Makes keys for accessing an encrypted Git repo.
 */
export function makeStorageKeyInfo (
  ai: ApiInput,
  type: string,
  keys: StorageKeys = {}
) {
  const { io } = ai.props
  if (keys.dataKey == null) keys.dataKey = base64.stringify(io.random(32))
  if (keys.syncKey == null) keys.syncKey = base64.stringify(io.random(20))

  return makeKeyInfo(type, keys, base64.parse(keys.dataKey))
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit (
  ai: ApiInput,
  login: LoginTree,
  ...keyInfos: Array<StorageWalletInfo>
): LoginKit {
  const { io } = ai.props
  const keyBoxes = keyInfos.map(info =>
    encrypt(io, utf8.parse(JSON.stringify(info)), login.loginKey)
  )
  const newSyncKeys: Array<string> = []
  for (const info of keyInfos) {
    if (info.keys.syncKey != null) {
      newSyncKeys.push(base16.stringify(base64.parse(info.keys.syncKey)))
    }
  }

  return {
    serverPath: '/v2/login/keys',
    server: { keyBoxes, newSyncKeys },
    stash: { keyBoxes },
    login: { keyInfos },
    loginId: login.loginId
  }
}

/**
 * Flattens an array of key structures, removing duplicates.
 */
export function mergeKeyInfos (keyInfos: Array<EdgeWalletInfo>) {
  const out = []
  const ids = {} // Maps ID's to output array indexes

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
          `Key integrity violation for ${id}: type ${type} does not match ${
            old.type
          }`
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
export function getAllWalletInfos (
  login: LoginTree,
  legacyWalletInfos: Array<EdgeWalletInfo> = []
) {
  const appIdMap: AppIdMap = {}
  const walletInfos: Array<EdgeWalletInfo> = []

  // Add the legacy wallets first:
  for (const info of legacyWalletInfos) {
    walletInfos.push(info)
    if (appIdMap[info.id] == null) appIdMap[info.id] = [login.appId]
    else appIdMap[info.id].push(login.appId)
  }

  function getAllWalletInfosLoop (login: LoginTree) {
    // Add our own walletInfos:
    for (const info of login.keyInfos) {
      walletInfos.push(info)
      if (appIdMap[info.id] == null) appIdMap[info.id] = [login.appId]
      else appIdMap[info.id].push(login.appId)
    }

    // Add our children's walletInfos:
    if (login.children) {
      for (const child of login.children) {
        getAllWalletInfosLoop(child)
      }
    }
  }
  getAllWalletInfosLoop(login)

  return { appIdMap, walletInfos: mergeKeyInfos(walletInfos) }
}

/**
 * Upgrades legacy wallet info structures into the new format.
 */
export function fixWalletInfo (walletInfo: EdgeWalletInfo): EdgeWalletInfo {
  const { id, keys, type } = walletInfo

  // Wallet types we need to fix:
  const defaults = {
    // BTC:
    'wallet:bitcoin': { format: 'bip32' },
    'wallet:bitcoin-bip44': { format: 'bip44', coinType: 0 },
    'wallet:bitcoin-bip49': { format: 'bip49', coinType: 0 },
    // BCH:
    'wallet:bitcoincash-bip32': { format: 'bip32' },
    'wallet:bitcoincash-bip44': { format: 'bip44', coinType: 145 },
    // BCH testnet:
    'wallet:bitcoincash-bip44-testnet': { format: 'bip44', coinType: 1 },
    'wallet:bitcoincash-testnet': { format: 'bip32' },
    // BTC testnet:
    'wallet:bitcoin-bip44-testnet': { format: 'bip44', coinType: 1 },
    'wallet:bitcoin-bip49-testnet': { format: 'bip49', coinType: 1 },
    'wallet:bitcoin-testnet': { format: 'bip32' },
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
    // XZC:
    'wallet:zcoin': { format: 'bip32', coinType: 136 },
    'wallet:zcoin-bip44': { format: 'bip44', coinType: 136 }
  }

  if (defaults[type]) {
    return {
      id,
      keys: { ...defaults[type], ...keys },
      type: type.replace(/-bip[0-9]+/, '')
    }
  }

  return walletInfo
}

/**
 * Combines two byte arrays via the XOR operation.
 */
export function xorData (a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error(`Array lengths do not match: ${a.length}, ${b.length}`)
  }

  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; ++i) {
    out[i] = a[i] ^ b[i]
  }
  return out
}

export function splitWalletInfo (
  walletInfo: EdgeWalletInfo,
  newWalletType: string
): EdgeWalletInfo {
  const { id, type, keys } = walletInfo
  if (!keys.dataKey || !keys.syncKey) {
    throw new Error(`Wallet ${id} is not a splittable type`)
  }

  const dataKey = base64.parse(keys.dataKey)
  const syncKey = base64.parse(keys.syncKey)
  const xorKey = xorData(
    hmacSha256(utf8.parse(type), dataKey),
    hmacSha256(utf8.parse(newWalletType), dataKey)
  )

  // Fix the id:
  const newWalletId = xorData(base64.parse(id), xorKey)
  const newSyncKey = xorData(syncKey, xorKey.subarray(0, syncKey.length))

  // Fix the keys:
  const networkName = type.replace(/wallet:/, '').replace('-', '')
  const newNetworkName = newWalletType.replace(/wallet:/, '').replace('-', '')
  const newKeys = {}
  for (const key of Object.keys(keys)) {
    if (key === networkName + 'Key') {
      newKeys[newNetworkName + 'Key'] = keys[key]
    } else {
      newKeys[key] = keys[key]
    }
  }

  return {
    id: base64.stringify(newWalletId),
    keys: {
      ...newKeys,
      syncKey: base64.stringify(newSyncKey)
    },
    type: newWalletType
  }
}
