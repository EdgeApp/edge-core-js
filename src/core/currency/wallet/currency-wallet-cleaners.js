// @flow

import {
  type Cleaner,
  asMap,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import { type EdgeMetadata } from '../../../types/types.js'

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

const asDiskMetadata: Cleaner<DiskMetadata> = asObject({
  bizId: asOptional(asNumber),
  category: asOptional(asString),
  exchangeAmount: asOptional(asMap(asNumber), {}),
  name: asOptional(asString),
  notes: asOptional(asString)
})
