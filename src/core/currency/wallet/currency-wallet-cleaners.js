// @flow

import {
  type Cleaner,
  asBoolean,
  asMap,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import {
  type EdgeMetadata,
  type EdgeTxSwap,
  type JsonObject
} from '../../../types/types.js'

/**
 * The on-disk metadata format,
 * which has a mandatory `exchangeAmount` table and no `amountFiat`.
 */
export type DiskMetadata = {
  bizId?: number,
  category?: string,
  exchangeAmount: { [fiatCurrencyCode: string]: number },
  name?: string,
  notes?: string
}

/**
 * The on-disk transaction format.
 */
export type TransactionFile = {
  txid: string,
  internal: boolean,
  creationDate: number,
  currencies: {
    [currencyCode: string]: {
      metadata: DiskMetadata,
      nativeAmount?: string,
      providerFeeSent?: string
    }
  },
  deviceDescription?: string,
  feeRateRequested?: 'high' | 'standard' | 'low' | JsonObject,
  feeRateUsed?: JsonObject,
  payees?: Array<{
    address: string,
    amount: string,
    currency: string,
    tag?: string
  }>,
  secret?: string,
  swap?: EdgeTxSwap
}

/**
 * The Airbitz on-disk transaction format.
 */
export type LegacyTransactionFile = {
  airbitzFeeWanted: number,
  meta: {
    amountFeeAirBitzSatoshi: number,
    balance: number,
    fee: number,

    // Metadata:
    amountCurrency: number,
    bizId: number,
    category: string,
    name: string,
    notes: string,

    // Obsolete/moved fields:
    attributes: number,
    amountSatoshi: number,
    amountFeeMinersSatoshi: number,
    airbitzFee: number
  },
  ntxid: string,
  state: {
    creationDate: number,
    internal: boolean,
    malleableTxId: string
  }
}

/**
 * The Airbitz on-disk address format.
 */
export type LegacyAddressFile = {
  seq: number, // index
  address: string,
  state: {
    recycleable: boolean,
    creationDate: number
  },
  meta: {
    amountSatoshi: number // requestAmount
    // TODO: Normal EdgeMetadata
  }
}

/**
 * An on-disk cache to quickly map Airbitz filenames to their dates.
 */
export type LegacyMapFile = {
  [fileName: string]: { timestamp: number, txidHash: string }
}

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
    if (/e/.test(String(exchangeAmount[currency]))) {
      delete exchangeAmount[currency]
    }
  }

  return { ...clean, amountFiat: exchangeAmount[walletFiat] }
}

export const asTxSwap: Cleaner<EdgeTxSwap> = asObject({
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

const asDiskMetadata: Cleaner<DiskMetadata> = asObject({
  bizId: asOptional(asNumber),
  category: asOptional(asString),
  exchangeAmount: asOptional(asMap(asNumber), {}),
  name: asOptional(asString),
  notes: asOptional(asString)
})
