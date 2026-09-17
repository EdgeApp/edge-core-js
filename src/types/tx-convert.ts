import type {
  EdgeTokenId,
  EdgeTransaction,
  EdgeTx,
  EdgeTxAmountMap,
  EdgeTxTokenData
} from './types'

/**
 * Converting between `EdgeTransaction` and `EdgeTx`.
 *
 * The structural difference is the only one that matters. `EdgeTransaction` is
 * scoped to a single `tokenId` and carries that asset's amount and metadata
 * flat, so a transaction moving two assets is two objects that each claim to
 * be the whole transaction. `EdgeTx` is one object per transaction with the
 * per-asset parts keyed.
 *
 * So the two directions are not symmetric. Going up merges one asset's view
 * into a whole transaction; going down projects a whole transaction back onto
 * one asset. Round-tripping through `EdgeTransaction` is therefore lossy by
 * construction -- a two-asset `EdgeTx` cannot survive it -- which is exactly
 * why the database stores the `EdgeTx`.
 */

/** Seconds since the epoch, as `EdgeTransaction` spells a date. */
function toIsoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

function fromIsoDate(date: string): number {
  return Math.round(new Date(date).valueOf() / 1000)
}

/**
 * One asset's view of a transaction, widened into a whole one.
 *
 * `pluginId` comes from the caller because `EdgeTransaction` does not carry
 * it -- the wallet does.
 */
export function toEdgeTx(tx: EdgeTransaction, pluginId: string): EdgeTx {
  const nativeAmounts: EdgeTxAmountMap = new Map([
    [tx.tokenId, tx.nativeAmount]
  ])

  const networkFees: EdgeTxAmountMap = new Map()
  for (const fee of tx.networkFees) {
    networkFees.set(fee.tokenId, fee.nativeAmount)
  }
  if (networkFees.size === 0) {
    /*
     * Most engines still report the flat `networkFee` and leave the array
     * empty, so reading only the array drops the fee outright -- silently,
     * because a transaction with no fee is a perfectly valid document.
     *
     * A token's own `networkFee` is usually zero and its real cost is
     * `parentNetworkFee`, which is why both are read.
     */
    networkFees.set(tx.tokenId, tx.networkFee)
    if (tx.tokenId != null && tx.parentNetworkFee != null) {
      networkFees.set(null, tx.parentNetworkFee)
    }
  }

  const tokenData = new Map<EdgeTokenId, EdgeTxTokenData>()
  const asset: EdgeTxTokenData = {}
  if (tx.metadata != null) asset.metadata = tx.metadata
  if (tx.assetAction != null) asset.assetAction = tx.assetAction
  if (tx.chainAssetAction != null) asset.chainAssetAction = tx.chainAssetAction
  if (Object.keys(asset).length > 0) tokenData.set(tx.tokenId, asset)

  const out: EdgeTx = {
    walletId: tx.walletId,
    txid: tx.txid,
    pluginId,

    date: toIsoDate(tx.date),
    blockHeight: tx.blockHeight,
    isSend: tx.isSend,

    nativeAmounts,
    networkFees,

    ourReceiveAddresses: tx.ourReceiveAddresses,
    memos: tx.memos,
    tokenData
  }

  if (tx.signedTx !== '') out.signedTx = tx.signedTx
  if (tx.txSecret != null) out.txSecret = tx.txSecret
  if (tx.chainAction != null) out.chainAction = tx.chainAction
  if (tx.savedAction != null) out.savedAction = tx.savedAction
  if (tx.feeRateUsed != null) out.feeRateUsed = tx.feeRateUsed
  if (tx.deviceDescription != null) out.deviceDescription = tx.deviceDescription
  if (tx.swapData != null) out.swapData = tx.swapData

  // Everything this device asked for when it built the transaction, kept
  // together so a reader can tell "we made this" from "we observed this":
  const makeTxParams = {
    spendTargets: tx.spendTargets,
    networkFeeOption: tx.networkFeeOption,
    requestedCustomFee: tx.requestedCustomFee
  }
  if (Object.values(makeTxParams).some(value => value != null)) {
    out.makeTxParams = makeTxParams
  }

  // `otherParams` has no home here, and that is deliberate: it is free-form
  // and plugin-controlled, and a swept UTXO transaction carries private keys
  // in it. Chain detail a plugin needs belongs in that plugin's own table.

  return out
}

/**
 * A whole transaction, projected back onto one asset.
 *
 * `currencyCode` comes from the caller because resolving a `tokenId` to one
 * needs the wallet's token map, which this layer does not have -- and getting
 * it wrong would be worse than asking.
 */
export function fromEdgeTx(
  tx: EdgeTx,
  tokenId: EdgeTokenId,
  currencyCode: string
): EdgeTransaction {
  const asset = tx.tokenData.get(tokenId)

  const out: EdgeTransaction = {
    tokenId,
    currencyCode,

    // An asset a transaction touched only by paying its fee has no amount of
    // its own, which reads as zero rather than as missing:
    nativeAmount: tx.nativeAmounts.get(tokenId) ?? '0',
    networkFees: [...tx.networkFees].map(([tokenId, nativeAmount]) => ({
      tokenId,
      nativeAmount
    })),

    blockHeight: tx.blockHeight,
    date: fromIsoDate(tx.date),

    txid: tx.txid,
    signedTx: tx.signedTx ?? '',
    memos: tx.memos,
    ourReceiveAddresses: tx.ourReceiveAddresses,

    isSend: tx.isSend,
    walletId: tx.walletId,

    // The deprecated fee fields. `networkFee` is this asset's own fee, and
    // `parentNetworkFee` is the chain's, which only differ for a token:
    networkFee: tx.networkFees.get(tokenId) ?? '0'
  }

  if (tokenId != null) {
    const parentFee = tx.networkFees.get(null)
    if (parentFee != null) out.parentNetworkFee = parentFee
  }

  if (tx.confirmations != null) out.confirmations = tx.confirmations
  if (asset?.metadata != null) out.metadata = asset.metadata
  if (asset?.assetAction != null) out.assetAction = asset.assetAction
  if (asset?.chainAssetAction != null) {
    out.chainAssetAction = asset.chainAssetAction
  }
  if (tx.chainAction != null) out.chainAction = tx.chainAction
  if (tx.savedAction != null) out.savedAction = tx.savedAction
  if (tx.feeRateUsed != null) out.feeRateUsed = tx.feeRateUsed
  if (tx.deviceDescription != null) out.deviceDescription = tx.deviceDescription
  if (tx.txSecret != null) out.txSecret = tx.txSecret
  if (tx.swapData != null) out.swapData = tx.swapData

  const { spendTargets, networkFeeOption, requestedCustomFee } =
    tx.makeTxParams ?? {}
  if (spendTargets != null) out.spendTargets = spendTargets
  if (networkFeeOption != null) out.networkFeeOption = networkFeeOption
  if (requestedCustomFee != null) out.requestedCustomFee = requestedCustomFee

  return out
}

/**
 * Every asset a transaction touched, which is what a caller reading an
 * `EdgeTx` as `EdgeTransaction`s has to iterate.
 *
 * The union of amounts and fees, because a token transfer moves the token and
 * pays its fee in the chain's own asset -- so neither map alone names both.
 */
export function txAssets(tx: EdgeTx): EdgeTokenId[] {
  const out = new Set<EdgeTokenId>(tx.nativeAmounts.keys())
  for (const tokenId of tx.networkFees.keys()) out.add(tokenId)
  return [...out]
}
