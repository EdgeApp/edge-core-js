// @flow

import { base64 } from 'rfc4648'

import {
  type EdgeCurrencyTools,
  type EdgeCurrencyWallet,
  type EdgeMetadata,
  type EdgeWalletInfo
} from '../../types/types.js'
import { hmacSha256 } from '../../util/crypto/crypto.js'
import { utf8 } from '../../util/encoding.js'
import { changeWalletStates } from '../account/account-files.js'
import { waitForCurrencyWallet } from '../currency/currency-selectors.js'
import { applyKit } from '../login/login.js'
import { getCurrencyTools } from '../plugins/plugins-selectors.js'
import { type ApiInput } from '../root-pixie.js'
import { makeKeysKit } from './keys.js'

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

function deriveXorKey (
  newWalletType: string,
  walletInfo: EdgeWalletInfo
): Uint8Array {
  const { keys, type } = walletInfo
  const dataKey = base64.parse(keys.dataKey)
  return xorData(
    hmacSha256(utf8.parse(type), dataKey),
    hmacSha256(utf8.parse(newWalletType), dataKey)
  )
}

function splitWalletId (
  newWalletType: string,
  walletInfo: EdgeWalletInfo
): string {
  const { id } = walletInfo
  const xorKey = deriveXorKey(newWalletType, walletInfo)
  return base64.stringify(xorData(base64.parse(id), xorKey))
}

function splitStorageKeys (
  newWalletType: string,
  walletInfo: EdgeWalletInfo
): Object {
  const { keys } = walletInfo
  const xorKey = deriveXorKey(newWalletType, walletInfo)
  const syncKey = base64.parse(keys.syncKey)

  return {
    dataKey: keys.dataKey,
    syncKey: base64.stringify(
      xorData(syncKey, xorKey.subarray(0, syncKey.length))
    )
  }
}

export async function splitWalletInfo (
  tools: EdgeCurrencyTools,
  newWalletType: string,
  walletInfo: EdgeWalletInfo
): Promise<EdgeWalletInfo> {
  const { id, keys } = walletInfo
  if (keys.dataKey == null || keys.syncKey == null) {
    throw new Error(`Wallet ${id} is not a splittable type`)
  }

  if (tools.splitKey == null) {
    throw new Error("This currency plugin doesn't do splitting")
  }
  const pluginKeys = await tools.splitKey(newWalletType, walletInfo)

  return {
    id: splitWalletId(newWalletType, walletInfo),
    keys: {
      ...splitStorageKeys(newWalletType, walletInfo),
      ...pluginKeys
    },
    type: newWalletType
  }
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

export async function splitWallet (
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
  const tools = await getCurrencyTools(ai, walletInfo.type)
  const newWalletInfo = await splitWalletInfo(tools, newWalletType, walletInfo)
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
  const tools = await getCurrencyTools(ai, walletInfo.type)
  const types =
    tools.listSplittableTypes != null
      ? await tools.listSplittableTypes(walletInfo)
      : []

  // Filter out wallet types we have already split:
  return types.filter(type => {
    const newWalletId = splitWalletId(type, walletInfo)
    const existingWalletInfo = allWalletInfosFull.find(
      walletInfo => walletInfo.id === newWalletId
    )
    // We can split the wallet if it doesn't exist, or is deleted:
    return (
      existingWalletInfo == null ||
      existingWalletInfo.archived ||
      existingWalletInfo.deleted
    )
  })
}
