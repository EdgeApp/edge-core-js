// @flow

import { base16, base64 } from 'rfc4648'

import {
  type EdgeCreateCurrencyWalletOptions,
  type EdgeCurrencyWallet,
  type EdgeMetadata,
  type EdgeWalletInfo
} from '../../types/types.js'
import { encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { utf8 } from '../../util/encoding.js'
import { changeWalletStates } from '../account/account-files.js'
import { waitForCurrencyWallet } from '../currency/currency-selectors.js'
import { applyKit } from '../login/login.js'
import { getCurrencyPlugin } from '../plugins/plugins-selectors.js'
import { type ApiInput } from '../root-pixie.js'
import {
  type AppIdMap,
  type LoginKit,
  type LoginTree,
  type StorageKeys,
  type StorageWalletInfo
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
      const data = base64.parse(info.keys.syncKey)
      newSyncKeys.push(base16.stringify(data).toLowerCase())
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

export function makeSplitWalletInfo (
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

export async function createCurrencyWallet (
  ai: ApiInput,
  accountId: string,
  walletType: string,
  opts: EdgeCreateCurrencyWalletOptions
) {
  const { login, loginTree } = ai.props.state.accounts[accountId]

  // Make the keys:
  const plugin = getCurrencyPlugin(ai.props.state, walletType)
  const keys =
    opts.keys || (await plugin.createPrivateKey(walletType, opts.keyOptions))
  const walletInfo = makeStorageKeyInfo(ai, walletType, keys)
  const kit = makeKeysKit(ai, login, fixWalletInfo(walletInfo))

  // Add the keys to the login:
  await applyKit(ai, loginTree, kit)
  const wallet = await waitForCurrencyWallet(ai, walletInfo.id)

  if (opts.name) await wallet.renameWallet(opts.name)
  if (opts.fiatCurrencyCode) {
    await wallet.setFiatCurrencyCode(opts.fiatCurrencyCode)
  }

  return wallet
}

async function protectBchWallet (wallet: EdgeCurrencyWallet) {
  // Create a UTXO which can be spend only on the ABC network
  const spendInfoSplit = {
    currencyCode: 'BCH',
    spendTargets: [
      {
        nativeAmount: '1000',
        otherParams: { script: { type: 'replayProtection' } }
      }
    ],
    metadata: {},
    networkFeeOption: 'high'
  }
  const splitTx = await wallet.makeSpend(spendInfoSplit)
  const signedSplitTx = await wallet.signTx(splitTx)
  const broadcastedSplitTx = await wallet.broadcastTx(signedSplitTx)
  await wallet.saveTx(broadcastedSplitTx)

  // Taint the rest of the wallet using the UTXO from before
  const { publicAddress } = await wallet.getReceiveAddress()
  const spendInfoTaint = {
    currencyCode: 'BCH',
    spendTargets: [{ publicAddress, nativeAmount: '0' }],
    metadata: {},
    networkFeeOption: 'high'
  }
  const maxAmount = await wallet.getMaxSpendable(spendInfoTaint)
  spendInfoTaint.spendTargets[0].nativeAmount = maxAmount
  const taintTx = await wallet.makeSpend(spendInfoTaint)
  const signedTaintTx = await wallet.signTx(taintTx)
  const broadcastedTaintTx = await wallet.broadcastTx(signedTaintTx)
  await wallet.saveTx(broadcastedTaintTx)
  const edgeMetadata: EdgeMetadata = {
    name: 'Replay Protection Tx',
    notes:
      'This transaction is to protect your BCH wallet from unintentionally spending BSV funds. Please wait for the transaction to confirm before making additional transactions using this BCH wallet.'
  }
  await wallet.saveTxMetadata(broadcastedTaintTx.txid, 'BCH', edgeMetadata)
}

export async function splitWalletInfo (
  ai: ApiInput,
  accountId: string,
  walletId: string,
  newWalletType: string
) {
  const selfState = ai.props.state.accounts[accountId]
  const { allWalletInfosFull, login, loginTree } = selfState

  // Find the wallet we are going to split:
  const walletInfo = allWalletInfosFull.find(
    walletInfo => walletInfo.id === walletId
  )
  if (!walletInfo) throw new Error(`Invalid wallet id ${walletId}`)

  // Handle BCH / BTC+segwit special case:
  if (
    newWalletType === 'wallet:bitcoincash' &&
    walletInfo.type === 'wallet:bitcoin' &&
    walletInfo.keys.format === 'bip49'
  ) {
    throw new Error(
      'Cannot split segwit-format Bitcoin wallets to Bitcoin Cash'
    )
  }

  // Handle BitcoinABC/SV replay protection:
  const needsProtection =
    newWalletType === 'wallet:bitcoinsv' &&
    walletInfo.type === 'wallet:bitcoincash'
  if (needsProtection) {
    const oldWallet = ai.props.output.currency.wallets[walletId].api
    if (!oldWallet) throw new Error('Missing Wallet')
    await protectBchWallet(oldWallet)
  }

  // See if the wallet has already been split:
  const newWalletInfo = makeSplitWalletInfo(walletInfo, newWalletType)
  const existingWalletInfo = allWalletInfosFull.find(
    walletInfo => walletInfo.id === newWalletInfo.id
  )
  if (existingWalletInfo) {
    if (existingWalletInfo.archived || existingWalletInfo.deleted) {
      // Simply undelete the existing wallet:
      const walletInfos = {}
      walletInfos[newWalletInfo.id] = { archived: false, deleted: false }
      await changeWalletStates(ai, accountId, walletInfos)
      return walletInfo.id
    }
    if (needsProtection) return newWalletInfo.id
    throw new Error('This wallet has already been split')
  }

  // Add the keys to the login:
  const kit = makeKeysKit(ai, login, newWalletInfo)
  await applyKit(ai, loginTree, kit)

  // Try to copy metadata on a best-effort basis.
  // In the future we should clone the repo instead:
  try {
    const wallet = await waitForCurrencyWallet(ai, newWalletInfo.id)
    const oldWallet = ai.props.output.currency.wallets[walletId].api
    if (oldWallet) {
      if (oldWallet.name) await wallet.renameWallet(oldWallet.name)
      if (oldWallet.fiatCurrencyCode) {
        await wallet.setFiatCurrencyCode(oldWallet.fiatCurrencyCode)
      }
    }
  } catch (e) {
    ai.props.onError(e)
  }

  return newWalletInfo.id
}

export async function listSplittableWalletTypes (
  ai: ApiInput,
  accountId: string,
  walletId: string
): Promise<Array<string>> {
  const { allWalletInfosFull } = ai.props.state.accounts[accountId]

  // Find the wallet we are going to split:
  const walletInfo = allWalletInfosFull.find(
    walletInfo => walletInfo.id === walletId
  )
  if (!walletInfo) throw new Error(`Invalid wallet id ${walletId}`)

  // Get the list of available types:
  const plugin = getCurrencyPlugin(ai.props.state, walletInfo.type)
  const types =
    plugin && plugin.getSplittableTypes
      ? plugin.getSplittableTypes(walletInfo)
      : []

  // Filter out wallet types we have already split:
  return types.filter(type => {
    const newWalletInfo = makeSplitWalletInfo(walletInfo, type)
    const existingWalletInfo = allWalletInfosFull.find(
      walletInfo => walletInfo.id === newWalletInfo.id
    )
    // We can split the wallet if it doesn't exist, or is deleted:
    return (
      !existingWalletInfo ||
      existingWalletInfo.archived ||
      existingWalletInfo.deleted
    )
  })
}
