import { base16, base64 } from 'rfc4648'

import { wasCreateKeysPayload } from '../../types/server-cleaners'
import {
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyWallet,
  EdgeMetadata,
  EdgeSpendInfo,
  EdgeWalletInfo,
  EdgeWalletStates,
  JsonObject
} from '../../types/types'
import { encrypt } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { changeWalletStates } from '../account/account-files'
import { waitForCurrencyWallet } from '../currency/currency-selectors'
import { applyKit } from '../login/login'
import {
  findCurrencyPluginId,
  getCurrencyTools,
  maybeFindCurrencyPluginId
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { AppIdMap, LoginKit, LoginTree, wasEdgeWalletInfo } from './login-types'

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
  keys: JsonObject,
  idKey: Uint8Array
): EdgeWalletInfo {
  return {
    id: base64.stringify(hmacSha256(utf8.parse(type), idKey)),
    type,
    keys
  }
}

/**
 * Makes keys for accessing an encrypted Git repo.
 */
export function makeStorageKeyInfo(
  ai: ApiInput,
  type: string,
  keys: JsonObject = {}
): EdgeWalletInfo {
  const { io } = ai.props
  if (keys.dataKey == null) keys.dataKey = base64.stringify(io.random(32))
  if (keys.syncKey == null) keys.syncKey = base64.stringify(io.random(20))
  if (typeof keys.dataKey !== 'string') {
    throw new TypeError('Invalid dataKey type')
  }
  return makeKeyInfo(type, keys, base64.parse(keys.dataKey))
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit(
  ai: ApiInput,
  login: LoginTree,
  ...keyInfos: EdgeWalletInfo[]
): LoginKit {
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
    if (info.keys.syncKey != null) {
      const data = base64.parse(info.keys.syncKey)
      newSyncKeys.push(base16.stringify(data).toLowerCase())
    }
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
  const defaults: { [type: string]: JsonObject } = {
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

/**
 * Combines two byte arrays via the XOR operation.
 */
export function xorData(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error(`Array lengths do not match: ${a.length}, ${b.length}`)
  }

  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; ++i) {
    out[i] = a[i] ^ b[i]
  }
  return out
}

export function makeSplitWalletInfo(
  walletInfo: EdgeWalletInfo,
  newWalletType: string
): EdgeWalletInfo {
  const { id, type, keys } = walletInfo
  if (keys.dataKey == null || keys.syncKey == null) {
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
  const newKeys: JsonObject = {}
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

export async function createCurrencyWallet(
  ai: ApiInput,
  accountId: string,
  walletType: string,
  opts: EdgeCreateCurrencyWalletOptions
): Promise<EdgeCurrencyWallet> {
  const { login, loginTree } = ai.props.state.accounts[accountId]
  const pluginId = findCurrencyPluginId(
    ai.props.state.plugins.currency,
    walletType
  )

  // Make the keys:
  const tools = await getCurrencyTools(ai, pluginId)
  let keys
  if (opts.keys != null) {
    keys = opts.keys
  } else if (opts.importText != null) {
    if (tools.importPrivateKey == null) {
      throw new Error('This wallet does not support importing keys')
    }
    keys = {
      ...(await tools.importPrivateKey(opts.importText, opts.keyOptions)),
      imported: true
    }
  } else {
    keys = {
      ...(await tools.createPrivateKey(walletType, opts.keyOptions)),
      imported: false
    }
  }

  const walletInfo = makeStorageKeyInfo(ai, walletType, keys)
  const kit = makeKeysKit(ai, login, fixWalletInfo(walletInfo))

  // Add the keys to the login:
  await applyKit(ai, loginTree, kit)
  const wallet = await waitForCurrencyWallet(ai, walletInfo.id)

  // Write ancillary files to disk:
  if (opts.migratedFromWalletId != null) {
    await changeWalletStates(ai, accountId, {
      [walletInfo.id]: {
        migratedFromWalletId: opts.migratedFromWalletId
      }
    })
  }
  if (opts.name != null) await wallet.renameWallet(opts.name)
  if (opts.fiatCurrencyCode != null) {
    await wallet.setFiatCurrencyCode(opts.fiatCurrencyCode)
  }

  return wallet
}

async function protectBchWallet(wallet: EdgeCurrencyWallet): Promise<void> {
  // Create a UTXO which can be spend only on the ABC network
  const spendInfoSplit: EdgeSpendInfo = {
    tokenId: null,
    spendTargets: [
      {
        nativeAmount: '10000',
        otherParams: { script: { type: 'replayProtection' } },
        publicAddress: ''
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
  const spendInfoTaint: EdgeSpendInfo = {
    tokenId: null,
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
  await wallet.saveTxMetadata(broadcastedTaintTx.txid, null, edgeMetadata)
}

export async function splitWalletInfo(
  ai: ApiInput,
  accountId: string,
  walletId: string,
  newWalletType: string
): Promise<string> {
  const accountState = ai.props.state.accounts[accountId]
  const { allWalletInfosFull, login, loginTree } = accountState

  // Find the wallet we are going to split:
  const walletInfo = allWalletInfosFull.find(
    walletInfo => walletInfo.id === walletId
  )
  if (walletInfo == null) throw new Error(`Invalid wallet id ${walletId}`)

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
    const oldWallet = ai.props.output.currency.wallets[walletId].walletApi
    if (oldWallet == null) throw new Error('Missing Wallet')
    await protectBchWallet(oldWallet)
  }

  // See if the wallet has already been split:
  const newWalletInfo = makeSplitWalletInfo(walletInfo, newWalletType)
  const existingWalletInfo = allWalletInfosFull.find(
    walletInfo => walletInfo.id === newWalletInfo.id
  )
  if (existingWalletInfo != null) {
    if (existingWalletInfo.archived || existingWalletInfo.deleted) {
      // Simply undelete the existing wallet:
      const walletInfos: EdgeWalletStates = {}
      walletInfos[newWalletInfo.id] = {
        archived: false,
        deleted: false,
        migratedFromWalletId: undefined
      }
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
    const oldWallet = ai.props.output.currency.wallets[walletId].walletApi
    if (oldWallet != null) {
      if (oldWallet.name != null) await wallet.renameWallet(oldWallet.name)
      if (oldWallet.fiatCurrencyCode != null) {
        await wallet.setFiatCurrencyCode(oldWallet.fiatCurrencyCode)
      }
    }
  } catch (error: unknown) {
    ai.props.onError(error)
  }

  return newWalletInfo.id
}

export async function listSplittableWalletTypes(
  ai: ApiInput,
  accountId: string,
  walletId: string
): Promise<string[]> {
  const { allWalletInfosFull } = ai.props.state.accounts[accountId]

  // Find the wallet we are going to split:
  const walletInfo = allWalletInfosFull.find(
    walletInfo => walletInfo.id === walletId
  )
  if (walletInfo == null) throw new Error(`Invalid wallet id ${walletId}`)
  const pluginId = maybeFindCurrencyPluginId(
    ai.props.state.plugins.currency,
    walletInfo.type
  )
  if (pluginId == null) return []

  // Get the list of available types:
  const tools = await getCurrencyTools(ai, pluginId)
  if (tools.getSplittableTypes == null) return []
  const types = await tools.getSplittableTypes(walletInfo)

  // Filter out wallet types we have already split:
  return types.filter(type => {
    const newWalletInfo = makeSplitWalletInfo(walletInfo, type)
    const existingWalletInfo = allWalletInfosFull.find(
      walletInfo => walletInfo.id === newWalletInfo.id
    )
    // We can split the wallet if it doesn't exist, or is deleted:
    return (
      existingWalletInfo == null ||
      existingWalletInfo.archived ||
      existingWalletInfo.deleted
    )
  })
}
