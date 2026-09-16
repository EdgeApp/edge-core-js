import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
  Cleaner,
  uncleaner
} from 'cleaners'

import {
  EdgeMakeTxParams,
  EdgeMemo,
  EdgeTx,
  EdgeTxTokenData,
  JsonObject
} from '../../types/types'
import { asTokenIdMap } from '../../util/asMap'
import {
  asEdgeAssetAction,
  asEdgeTxAction,
  asEdgeTxSwap
} from '../currency/wallet/currency-wallet-cleaners'
import { asEdgeMetadata } from '../currency/wallet/metadata'

/**
 * The JSON boundary for `EdgeTx`.
 *
 * `EdgeTx` *is* the `tx_chain` document -- there is no separate storage type
 * and no mapping layer, only this. Everything it does is either spelling a
 * `Map` as a JSON object, or refusing a document that could not have come
 * from a plugin.
 */

const asJsonObject: Cleaner<JsonObject> = asObject(raw => raw)

const asEdgeMemo = asObject<EdgeMemo>({
  type: asValue('text', 'number', 'hex'),
  value: asString,
  hidden: asOptional(asBoolean),
  memoName: asOptional(asString)
})

const asEdgeTxTokenData = asObject<EdgeTxTokenData>({
  metadata: asOptional(asEdgeMetadata),
  assetAction: asOptional(asEdgeAssetAction),
  chainAssetAction: asOptional(asEdgeAssetAction)
})

const asEdgeMakeTxParams = asObject<EdgeMakeTxParams>({
  spendTargets: asOptional(
    asArray(
      asObject({
        currencyCode: asString,
        nativeAmount: asString,
        publicAddress: asString,
        memo: asOptional(asString),
        uniqueIdentifier: asOptional(asString)
      })
    )
  ),
  networkFeeOption: asOptional(asValue('high', 'standard', 'low', 'custom')),
  requestedCustomFee: asOptional(asJsonObject)
})

/**
 * Amounts stay strings all the way down.
 *
 * A 256-bit integer does not fit a JavaScript number, and parsing one would
 * lose digits silently rather than fail. Nothing in the core does arithmetic
 * on these; a caller that needs to reads them into `BigInt`.
 */
const asNativeAmount: Cleaner<string> = raw => {
  const text = asString(raw)
  if (!/^-?\d+$/.test(text)) {
    throw new TypeError(
      `Expected an integer amount, got ${JSON.stringify(raw)}`
    )
  }
  return text
}

/**
 * ISO 8601, and it has to parse.
 *
 * `tx_chain.date` is a generated column over `unixepoch()` of this string, and
 * `tx_asset_idx.effective_date` is NOT NULL -- so a date SQLite cannot read
 * fails the write rather than storing a transaction that no page can reach.
 * Catching it here says which field was wrong.
 */
const asIsoDate: Cleaner<string> = raw => {
  const text = asString(raw)
  if (isNaN(new Date(text).valueOf())) {
    throw new TypeError(`Expected an ISO 8601 date, got ${JSON.stringify(raw)}`)
  }
  return text
}

export const asEdgeTx = asObject<EdgeTx>({
  walletId: asString,
  txid: asString,
  pluginId: asString,

  date: asIsoDate,
  blockHeight: asNumber,
  isSend: asBoolean,

  nativeAmounts: asTokenIdMap(asNativeAmount),
  networkFees: asTokenIdMap(asNativeAmount),

  ourReceiveAddresses: asArray(asString),
  memos: asArray(asEdgeMemo),
  signedTx: asOptional(asString),
  txSecret: asOptional(asString),

  tokenData: asTokenIdMap(asEdgeTxTokenData),
  chainAction: asOptional(asEdgeTxAction),
  savedAction: asOptional(asEdgeTxAction),

  feeRateUsed: asOptional(asJsonObject),
  deviceDescription: asOptional(asString),
  makeTxParams: asOptional(asEdgeMakeTxParams),
  swapData: asOptional(asEdgeTxSwap)
})

/** The reverse: an `EdgeTx` back into the JSON the document holds. */
export const wasEdgeTx = uncleaner(asEdgeTx)

/**
 * `confirmations` is deliberately absent above.
 *
 * It is derived from the wallet's current block height, so storing it would
 * mean every transaction in a wallet going stale each time a block arrives.
 * It is computed on read instead.
 */
