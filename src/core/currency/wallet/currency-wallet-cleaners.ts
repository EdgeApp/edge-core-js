import {
  asArray,
  asBoolean,
  asEither,
  asMaybe,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
  Cleaner
} from 'cleaners'

import {
  EdgeMetadata,
  EdgeTxFiat,
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
      fiatData?: EdgeTxFiat
      metadata: DiskMetadata
      nativeAmount?: string
      providerFeeSent?: string
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

export const asEdgeTxFiat = asObject<EdgeTxFiat>({
  orderId: asString,
  orderUri: asOptional(asString),
  isEstimate: asBoolean,

  fiatPlugin: asObject({
    providerId: asString,
    providerDisplayName: asString,
    supportEmail: asOptional(asString)
  }),
  txType: asValue('buy', 'sell', 'sellNetworkFee'),
  payinAddress: asMaybe(asString),
  payoutAddress: asMaybe(asString),
  fiatCurrencyCode: asString,
  cryptoPluginId: asString,
  cryptoTokenId: asMaybe(asString),
  cryptoNativeAmount: asString,
  walletId: asString
})

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

/**
 * This uses currency codes, since we cannot break the data on disk.
 * To fix this one day, we can either migrate to a new file name,
 * or we can use `asEither` to switch between this format
 * and some new format based on token ID's.
 */
export const asEnabledTokensFile = asArray<string>(asString)

export const asTransactionFile = asObject<TransactionFile>({
  txid: asString,
  internal: asBoolean,
  creationDate: asNumber,
  currencies: asObject(
    asObject({
      fiatData: asOptional(asEdgeTxFiat),
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
