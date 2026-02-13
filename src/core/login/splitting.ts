import { asMaybe } from 'cleaners'
import { base64 } from 'rfc4648'

import {
  EdgeCurrencyWallet,
  EdgeResult,
  EdgeSpendInfo,
  EdgeSplitCurrencyWallet,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../types/types'
import { hmacSha256 } from '../../util/crypto/hashes'
import { makeEdgeResult } from '../../util/edgeResult'
import { utf8 } from '../../util/encoding'
import { changeWalletStates } from '../account/account-files'
import { waitForCurrencyWallet } from '../currency/currency-selectors'
import { applyKit } from '../login/login'
import {
  getCurrencyTools,
  maybeFindCurrencyPluginId
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { makeKeysKit } from './keys'
import { asEdgeStorageKeys, wasEdgeStorageKeys } from './storage-keys'

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

export function makeSplitWalletInfo(
  walletInfo: EdgeWalletInfo,
  newWalletType: string
): EdgeWalletInfo {
  const { id, type, keys } = walletInfo

  const cleanKeys = asMaybe(asEdgeStorageKeys)(keys)
  if (cleanKeys == null) {
    throw new Error(`Wallet ${id} is not a splittable type`)
  }

  const { dataKey, syncKey } = cleanKeys
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
  const newKeys: { [key: string]: unknown } = wasEdgeStorageKeys({
    dataKey,
    syncKey: newSyncKey
  })
  for (const key of Object.keys(keys)) {
    const newKey = key === networkName + 'Key' ? newNetworkName + 'Key' : key
    if (newKeys[newKey] != null) continue
    newKeys[newKey] = keys[key]
  }

  return {
    id: base64.stringify(newWalletId),
    keys: newKeys,
    type: newWalletType
  }
}

export async function splitWalletInfo(
  ai: ApiInput,
  accountId: string,
  walletInfo: EdgeWalletInfoFull,
  splitWallets: EdgeSplitCurrencyWallet[],
  rejectDupes: boolean
): Promise<Array<EdgeResult<EdgeCurrencyWallet>>> {
  const accountState = ai.props.state.accounts[accountId]
  const { allWalletInfosFull, sessionKey } = accountState

  // Validate the wallet types:
  const plugins = ai.props.state.plugins.currency
  const splitInfos = new Map<string, EdgeWalletInfo>()
  for (const item of splitWallets) {
    const { walletType } = item
    const pluginId = maybeFindCurrencyPluginId(plugins, item.walletType)
    if (pluginId == null) {
      throw new Error(`Cannot find plugin for wallet type "${walletType}"`)
    }
    if (splitInfos.has(walletType)) {
      throw new Error(`Duplicate wallet type "${walletType}"`)
    }
    splitInfos.set(walletType, makeSplitWalletInfo(walletInfo, walletType))
  }

  // Do we need BitcoinABC/SV replay protection?
  const needsProtection =
    walletInfo.type === 'wallet:bitcoincash' &&
    // We can re-protect a wallet by doing a repeated split,
    // so don't check if the wallet already exists:
    splitInfos.has('wallet:bitcoinsv')
  if (needsProtection) {
    const existingWallet =
      ai.props.output?.currency?.wallets[walletInfo.id]?.walletApi
    if (existingWallet == null) {
      throw new Error(`Cannot find wallet ${walletInfo.id}`)
    }
    await protectBchWallet(existingWallet)
  }

  // Sort the wallet infos into two categories:
  const toRestore: EdgeWalletInfoFull[] = []
  const toCreate: EdgeWalletInfo[] = []
  for (const newWalletInfo of splitInfos.values()) {
    const existingWalletInfo = allWalletInfosFull.find(
      info => info.id === newWalletInfo.id
    )
    if (existingWalletInfo == null) {
      toCreate.push(newWalletInfo)
    } else {
      if (existingWalletInfo.archived || existingWalletInfo.deleted) {
        toRestore.push(existingWalletInfo)
      } else if (rejectDupes) {
        if (
          // It's OK to re-split if we are adding protection:
          walletInfo.type !== 'wallet:bitcoincash' ||
          newWalletInfo.type !== 'wallet:bitcoinsv'
        ) {
          throw new Error(
            `This wallet has already been split (${newWalletInfo.type})`
          )
        }
      }
    }
  }

  // Restore anything that has simply been deleted:
  if (toRestore.length > 0) {
    const newStates: EdgeWalletStates = {}
    for (const existingWalletInfo of toRestore) {
      newStates[existingWalletInfo.id] = {
        archived: false,
        deleted: false,
        migratedFromWalletId: existingWalletInfo.migratedFromWalletId
      }
    }
    await changeWalletStates(ai, accountId, newStates)
  }

  // Add the keys to the login:
  if (toCreate.length > 0) {
    const kit = makeKeysKit(ai, sessionKey, toCreate, true)
    await applyKit(ai, sessionKey, kit)
  }

  // Wait for the new wallets to load:
  const out = await Promise.all(
    splitWallets.map(async splitInfo => {
      const walletInfo = splitInfos.get(splitInfo.walletType)
      if (walletInfo == null) {
        throw new Error(`Missing wallet info for ${splitInfo.walletType}`)
      }
      return await makeEdgeResult(
        finishWalletSplitting(
          ai,
          walletInfo.id,
          toCreate.find(info => info.type === splitInfo.walletType) != null
            ? splitInfo
            : undefined
        )
      )
    })
  )

  return out
}

async function finishWalletSplitting(
  ai: ApiInput,
  walletId: string,
  item?: EdgeSplitCurrencyWallet
): Promise<EdgeCurrencyWallet> {
  const wallet = await waitForCurrencyWallet(ai, walletId)

  // Try to copy metadata on a best-effort basis.
  // In the future we should clone the repo instead:
  if (item?.name != null) {
    await wallet
      .renameWallet(item.name)
      .catch((error: unknown) => ai.props.onError(error))
  }
  if (item?.fiatCurrencyCode != null) {
    await wallet
      .setFiatCurrencyCode(item.fiatCurrencyCode)
      .catch((error: unknown) => ai.props.onError(error))
  }

  return wallet
}

async function protectBchWallet(wallet: EdgeCurrencyWallet): Promise<void> {
  const bchCurrency = { currencyCode: 'BCH', tokenId: null }

  // Create a UTXO which can be spend only on the ABC network
  const spendInfoSplit: EdgeSpendInfo = {
    ...bchCurrency,
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
  const { publicAddress } = await wallet.getReceiveAddress(bchCurrency)
  const spendInfoTaint: EdgeSpendInfo = {
    ...bchCurrency,
    metadata: {
      name: 'Replay Protection Tx',
      notes:
        'This transaction is to protect your BCH wallet from unintentionally spending BSV funds. Please wait for the transaction to confirm before making additional transactions using this BCH wallet.'
    },
    networkFeeOption: 'high',
    spendTargets: [{ publicAddress, nativeAmount: '0' }]
  }
  const maxAmount = await wallet.getMaxSpendable(spendInfoTaint)
  spendInfoTaint.spendTargets[0].nativeAmount = maxAmount
  const taintTx = await wallet.makeSpend(spendInfoTaint)
  const signedTaintTx = await wallet.signTx(taintTx)
  const broadcastedTaintTx = await wallet.broadcastTx(signedTaintTx)
  await wallet.saveTx(broadcastedTaintTx)
}

/**
 * Combines two byte arrays via the XOR operation.
 */
function xorData(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error(`Array lengths do not match: ${a.length}, ${b.length}`)
  }

  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; ++i) {
    out[i] = a[i] ^ b[i]
  }
  return out
}
