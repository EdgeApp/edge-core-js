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
  EdgeAssetAmount,
  EdgeFiatAmount,
  EdgeMetadata,
  EdgeTxAction,
  EdgeTxActionFiat,
  EdgeTxActionFiatType,
  EdgeTxActionStakeType,
  EdgeTxActionSwap,
  EdgeTxActionSwapType,
  EdgeTxSwap,
  JsonObject
} from '../../../types/types'
import { asJsonObject } from '../../../util/file-helpers'

/**
 * The on-disk metadata format,
 * which has a mandatory `exchangeAmount` table and no `amountFiat`.
 */
export interface DiskMetadata {
  bizId?: number
  category?: string
  exchangeAmount: { [fiatCurrencyCode: string]: number }
  name?: string
  notes?: string
}

/**
 * The on-disk transaction format.
 */
export interface TransactionFile {
  txid: string
  internal: boolean
  creationDate: number
  currencies: {
    [currencyCode: string]: {
      metadata: DiskMetadata
      nativeAmount?: string
      providerFeeSent?: string
    }
  }
  tokens: {
    [tokenId: string]: {
      savedAction?: EdgeTxAction
    }
  }
  deviceDescription?: string
  feeRateRequested?: 'high' | 'standard' | 'low' | JsonObject
  feeRateUsed?: JsonObject
  payees?: Array<{
    address: string
    amount: string
    currency: string
    tag?: string
  }>
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

/**
 * Turns user-provided metadata into its on-disk format.
 */
export function packMetadata(
  raw: EdgeMetadata,
  walletFiat: string
): DiskMetadata {
  const clean = asDiskMetadata(raw)

  if (typeof raw.amountFiat === 'number') {
    clean.exchangeAmount[walletFiat] = raw.amountFiat
  }

  return clean
}

/**
 * Turns on-disk metadata into the user-facing format.
 */
export function unpackMetadata(
  raw: DiskMetadata,
  walletFiat: string
): EdgeMetadata {
  const clean = asDiskMetadata(raw)
  const { exchangeAmount } = clean

  // Delete corrupt amounts that exceed the Javascript number range:
  for (const currency of Object.keys(exchangeAmount)) {
    if (String(exchangeAmount[currency]).includes('e')) {
      delete exchangeAmount[currency]
    }
  }

  return { ...clean, amountFiat: exchangeAmount[walletFiat] }
}

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

const asDiskMetadata = asObject<DiskMetadata>({
  bizId: asOptional(asNumber),
  category: asOptional(asString),
  exchangeAmount: asOptional(asObject(asNumber), () => ({})),
  name: asOptional(asString),
  notes: asOptional(asString)
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

export const asEdgeAssetAmount = asObject<EdgeAssetAmount>({
  pluginId: asString,
  tokenId: asOptional(asString),
  nativeAmount: asOptional(asIntegerString)
})
export const asEdgeFiatAmount = asObject<EdgeFiatAmount>({
  // core-js style fiat code including 'iso:'
  fiatCurrencyCode: asString,
  fiatAmount: asString
})

export const asEdgeTxActionSwapType: Cleaner<EdgeTxActionSwapType> = asValue(
  'swap',
  'swapOrderPost',
  'swapOrderFill',
  'swapOrderCancel'
)

export const asEdgeTxActionSwap = asObject<EdgeTxActionSwap>({
  type: asEdgeTxActionSwapType,
  orderId: asOptional(asString),
  canBePartial: asOptional(asBoolean),
  sourceAsset: asEdgeAssetAmount,
  destAsset: asEdgeAssetAmount
})

export const asEdgeTxActionStakeType: Cleaner<EdgeTxActionStakeType> = asValue(
  'stake',
  'stakeOrder',
  'unstake',
  'unstakeOrder'
)

export const asEdgeTxActionStake = asObject({
  type: asEdgeTxActionStakeType,
  stakeAssets: asArray(asEdgeAssetAmount)
})

export const asEdgeTxActionFiatType: Cleaner<EdgeTxActionFiatType> = asValue(
  'buy',
  'sell',
  'sellNetworkFee'
)

export const asEdgeTxActionFiat = asObject<EdgeTxActionFiat>({
  type: asEdgeTxActionFiatType,

  orderId: asString,
  walletId: asString,
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

export const asEdgeTxAction: Cleaner<EdgeTxAction> = asEither(
  asEdgeTxActionSwap,
  asEdgeTxActionStake,
  asEdgeTxActionFiat
)

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

export const asTransactionFile = asObject<TransactionFile>({
  txid: asString,
  internal: asBoolean,
  creationDate: asNumber,
  currencies: asObject(
    asObject({
      metadata: asDiskMetadata,
      nativeAmount: asOptional(asString),
      providerFeeSent: asOptional(asString)
    })
  ),
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
  secret: asOptional(asString),
  swap: asOptional(asEdgeTxSwap),
  tokens: asOptional(
    asObject(
      asObject({
        savedAction: asOptional(asEdgeTxAction)
      })
    ),
    () => ({})
  )
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
