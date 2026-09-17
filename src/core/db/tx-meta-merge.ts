import { EdgeTx, EdgeTxTokenData } from '../../types/types'
import { asTransactionFile } from '../currency/wallet/currency-wallet-cleaners'

/**
 * Putting the user's metadata back onto a transaction.
 *
 * The two halves are stored apart on purpose -- `tx_chain` is what the chain
 * said and `tx_meta` is what the user wrote, and either can arrive without
 * the other. A reader wants one object, so the join happens here, at the
 * point every query already pays for reading rows.
 *
 * Metadata wins over what the plugin reported for the same field. A plugin's
 * `metadata` is a suggestion it made when it first saw the transaction; the
 * file is what the user has since typed, possibly on another device.
 */

/** The date the index sorted on, which is the earlier of the two. */
export function mergeTxMeta(tx: EdgeTx, metaDoc: string): void {
  const file = asTransactionFile(JSON.parse(metaDoc))

  for (const [tokenId, asset] of file.tokens) {
    const existing = tx.tokenData.get(tokenId)
    const next: EdgeTxTokenData = { ...existing }
    if (asset.metadata != null) next.metadata = asset.metadata
    if (asset.assetAction != null) next.assetAction = asset.assetAction
    tx.tokenData.set(tokenId, next)
  }

  if (file.savedAction != null) tx.savedAction = file.savedAction
  if (file.swap != null) tx.swapData = file.swap
  if (file.secret != null) tx.txSecret = file.secret
  if (file.deviceDescription != null) {
    tx.deviceDescription = file.deviceDescription
  }
  if (file.feeRateUsed != null && tx.feeRateUsed == null) {
    tx.feeRateUsed = file.feeRateUsed
  }

  /*
   * What this device asked for when it built the transaction. The file is
   * the only record of it once the sending device is gone, which is why it
   * is read back rather than left to whoever still has the original object.
   */
  const spendTargets = file.payees?.map(payee => ({
    currencyCode: payee.currency,
    memo: payee.tag,
    nativeAmount: payee.amount,
    publicAddress: payee.address,
    uniqueIdentifier: payee.tag
  }))
  const feeRate = file.feeRateRequested
  if (spendTargets != null || feeRate != null) {
    tx.makeTxParams = {
      ...tx.makeTxParams,
      ...(spendTargets == null ? {} : { spendTargets }),
      ...(feeRate == null
        ? {}
        : typeof feeRate === 'string'
        ? { networkFeeOption: feeRate }
        : { networkFeeOption: 'custom' as const, requestedCustomFee: feeRate })
    }
  }

  /*
   * The metadata's date wins when it is earlier.
   *
   * `tx_asset_idx.effective_date` is already the minimum of the two, and it
   * is what every sort and every date predicate runs against -- so returning
   * the chain's date would hand a reader a list ordered by one number and
   * labelled with another.
   */
  const chainDate = Math.round(new Date(tx.date).valueOf() / 1000)
  if (file.creationDate > 0 && file.creationDate < chainDate) {
    tx.date = new Date(file.creationDate * 1000).toISOString()
  }
}
