import {
  asArray,
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
  Cleaner
} from 'cleaners'

import {
  EdgeAssetAction,
  EdgeAssetActionType,
  EdgeAssetAmount,
  EdgeFiatAmount,
  EdgeMetadata,
  EdgeSwapInfo,
  EdgeTokenId,
  EdgeTxAction,
  EdgeTxActionFiat,
  EdgeTxActionStake,
  EdgeTxActionSwap,
  EdgeTxActionTokenApproval,
  EdgeTxSwap
} from '../../../types/types'
import { asMap, asTokenIdMap } from '../../../util/asMap'
import { asJsonObject } from '../../../util/file-helpers'
import { asEdgeMetadata } from './metadata'

export interface TransactionAsset {
  assetAction?: EdgeAssetAction
  metadata: EdgeMetadata
  nativeAmount?: string
  providerFeeSent?: string
}

/**
 * The on-disk transaction format.
 */
export interface TransactionFile {
  txid: string
  internal: boolean
  creationDate: number
  currencies: Map<string, TransactionAsset>
  tokens: Map<EdgeTokenId, TransactionAsset>

  deviceDescription?: string
  feeRateRequested?: 'high' | 'standard' | 'low' | object
  feeRateUsed?: object
  payees?: Array<{
    address: string
    amount: string
    currency: string
    tag?: string
  }>
  savedAction?: EdgeTxAction
  secret?: string
  swap?: EdgeTxSwap
}

/**
 * The Airbitz on-disk transaction format.
 */
export interface LegacyTransactionFile {
  airbitzFeeWanted: number
  meta: {
    amountFeeAirBitzSatoshi: number
    balance: number
    fee: number

    // Metadata:
    amountCurrency: number
    bizId: number
    category: string
    name: string
    notes: string

    // Obsolete/moved fields:
    attributes: number
    amountSatoshi: number
    amountFeeMinersSatoshi: number
    airbitzFee: number
  }
  ntxid: string
  state: {
    creationDate: number
    internal: boolean
    malleableTxId: string
  }
}

/**
 * The Airbitz on-disk address format.
 */
interface LegacyAddressFile {
  seq: number // index
  address: string
  state: {
    recycleable: boolean
    creationDate: number
  }
  meta: {
    amountSatoshi: number // requestAmount
    // TODO: Normal EdgeMetadata
  }
}

/**
 * An on-disk cache to quickly map Airbitz filenames to their dates.
 */
interface LegacyMapFile {
  [fileName: string]: { timestamp: number; txidHash: string }
}

// ---------------------------------------------------------------------
// building-block cleaners
// ---------------------------------------------------------------------

const asFeeRate: Cleaner<'high' | 'standard' | 'low'> = asValue(
  'high',
  'standard',
  'low'
)

export const asEdgeTxSwap = asObject<EdgeTxSwap>({
  orderId: asOptional(asString),
  orderUri: asOptional(asString),
  isEstimate: asBoolean,

  // The EdgeSwapInfo from the swap plugin:
  plugin: asObject({
    pluginId: asString,
    displayName: asString,
    supportEmail: asOptional(asString)
  }),

  // Address information:
  payoutAddress: asString,
  payoutCurrencyCode: asString,
  payoutNativeAmount: asString,
  payoutWalletId: asString,
  refundAddress: asOptional(asString)
})

export function asIntegerString(raw: unknown): string {
  const clean = asString(raw)
  if (!/^\d+$/.test(clean)) {
    throw new Error('Expected an integer string')
  }
  return clean
}

// ---------------------------------------------------------------------
// file cleaners
// ---------------------------------------------------------------------

export const asEdgeTokenId = asEither(asString, asNull)

export const asEdgeAssetAmount = asObject<EdgeAssetAmount>({
  pluginId: asString,
  tokenId: asEdgeTokenId,
  nativeAmount: asOptional(asIntegerString)
})
export const asEdgeFiatAmount = asObject<EdgeFiatAmount>({
  // core-js style fiat code including 'iso:'
  fiatCurrencyCode: asString,
  fiatAmount: asString
})

export const asEdgeSwapInfo = asObject<EdgeSwapInfo>({
  pluginId: asString,
  displayName: asString,
  isDex: asOptional(asBoolean),
  orderUri: asOptional(asString), // The orderId would be appended to this
  supportEmail: asString
})

export const asEdgeTxActionSwap = asObject<EdgeTxActionSwap>({
  actionType: asValue('swap'),
  swapInfo: asEdgeSwapInfo,
  orderId: asOptional(asString),
  orderUri: asOptional(asString),
  isEstimate: asOptional(asBoolean),
  canBePartial: asOptional(asBoolean),
  fromAsset: asEdgeAssetAmount,
  toAsset: asEdgeAssetAmount,
  payoutWalletId: asString,
  payoutAddress: asString,
  refundAddress: asOptional(asString)
})

export const asEdgeTxActionStake = asObject<EdgeTxActionStake>({
  actionType: asValue('stake'),
  pluginId: asString,
  stakeAssets: asArray(asEdgeAssetAmount)
})

export const asEdgeTxActionFiat = asObject<EdgeTxActionFiat>({
  actionType: asValue('fiat'),

  orderId: asString,
  orderUri: asOptional(asString),
  isEstimate: asBoolean,

  fiatPlugin: asObject({
    providerId: asString,
    providerDisplayName: asString,
    supportEmail: asOptional(asString)
  }),

  payinAddress: asOptional(asString),
  payoutAddress: asOptional(asString),
  fiatAsset: asEdgeFiatAmount,
  cryptoAsset: asEdgeAssetAmount
})

export const asEdgeTxActionTokenApproval = asObject<EdgeTxActionTokenApproval>({
  actionType: asValue('tokenApproval'),
  tokenApproved: asEdgeAssetAmount,
  tokenContractAddress: asString,
  contractAddress: asString
})

export const asEdgeTxAction: Cleaner<EdgeTxAction> = asEither(
  asEdgeTxActionSwap,
  asEdgeTxActionStake,
  asEdgeTxActionFiat,
  asEdgeTxActionTokenApproval
)

export const asEdgeAssetActionType: Cleaner<EdgeAssetActionType> = asValue(
  'stake',
  'stakeNetworkFee',
  'stakeOrder',
  'unstake',
  'unstakeNetworkFee',
  'unstakeOrder',
  'swap',
  'swapNetworkFee',
  'swapOrderPost',
  'swapOrderFill',
  'swapOrderCancel',
  'buy',
  'sell',
  'sellNetworkFee',
  'tokenApproval',
  'transfer',
  'transferNetworkFee'
)

export const asEdgeAssetAction = asObject({
  assetActionType: asEdgeAssetActionType
})

/**
 * Old core versions used currency codes instead of tokenId's.
 */
export const asLegacyTokensFile = asArray<string>(asString)

/**
 * Stores enabled tokenId's on disk.
 */
export const asTokensFile = asObject({
  // All the tokens that the engine should check.
  // This includes both manually-enabled tokens and auto-enabled tokens:
  enabledTokenIds: asArray(asString),

  // These tokenId's have been detected on-chain at least once.
  // The user can still remove them from the enabled tokens list.
  detectedTokenIds: asArray(asString)
})

const asTransactionAsset = asObject<TransactionAsset>({
  metadata: asEdgeMetadata,
  nativeAmount: asOptional(asString),
  providerFeeSent: asOptional(asString)
})

export const asTransactionFile = asObject<TransactionFile>({
  txid: asString,
  internal: asBoolean,
  creationDate: asNumber,
  currencies: asMap(asTransactionAsset),
  tokens: asOptional(asTokenIdMap(asTransactionAsset), () => new Map()),
  deviceDescription: asOptional(asString),
  feeRateRequested: asOptional(asEither(asFeeRate, asJsonObject)),
  feeRateUsed: asOptional(asJsonObject),
  payees: asOptional(
    asArray(
      asObject({
        address: asString,
        amount: asString,
        currency: asString,
        tag: asOptional(asString)
      })
    )
  ),
  savedAction: asOptional(asEdgeTxAction),
  secret: asOptional(asString),
  swap: asOptional(asEdgeTxSwap)
})

export const asLegacyTransactionFile = asObject({
  airbitzFeeWanted: asNumber,
  meta: asObject({
    amountFeeAirBitzSatoshi: asNumber,
    balance: asNumber,
    fee: asNumber,

    // Metadata:
    amountCurrency: asNumber,
    bizId: asNumber,
    category: asString,
    name: asString,
    notes: asString,

    // Obsolete/moved fields:
    attributes: asNumber,
    amountSatoshi: asNumber,
    amountFeeMinersSatoshi: asNumber,
    airbitzFee: asNumber
  }),
  ntxid: asString,
  state: asObject({
    creationDate: asNumber,
    internal: asBoolean,
    malleableTxId: asString
  })
})

export const asLegacyAddressFile = asObject<LegacyAddressFile>({
  seq: asNumber, // index
  address: asString,
  state: asObject({
    recycleable: asOptional(asBoolean, true),
    creationDate: asOptional(asNumber, 0)
  }),
  meta: asObject({
    amountSatoshi: asOptional(asNumber, 0) // requestAmount
    // TODO: Normal EdgeMetadata
  }).withRest
})

export const asLegacyMapFile: Cleaner<LegacyMapFile> = asObject(
  asObject({
    timestamp: asNumber,
    txidHash: asString
  })
)

/**
 * Public keys cached in the wallet's local storage.
 */
export const asPublicKeyFile = asObject({
  walletInfo: asObject({
    id: asString,
    keys: asJsonObject,
    type: asString
  })
})

export const asWalletFiatFile = asObject({
  fiat: asOptional(asString),
  num: asOptional(asNumber)
})

export const asWalletNameFile = asObject({
  walletName: asEither(asString, asNull)
})
