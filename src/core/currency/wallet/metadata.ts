import { asNumber, asObject, asOptional, asString, Cleaner } from 'cleaners'

import { EdgeMetadata, EdgeMetadataChange } from '../../../types/types'
import { CurrencyWalletInput } from './currency-wallet-pixie'

export const asEdgeMetadata: Cleaner<EdgeMetadata> = raw => {
  const clean = asDiskMetadata(raw)
  const { exchangeAmount = {} } = clean

  // Delete corrupt amounts that exceed the Javascript number range:
  for (const fiat of Object.keys(clean)) {
    if (String(exchangeAmount[fiat]).includes('e')) {
      delete exchangeAmount[fiat]
    }
  }

  return clean
}

export function mergeMetadata(
  under: EdgeMetadata,
  over: EdgeMetadata | EdgeMetadataChange
): EdgeMetadata {
  const out: EdgeMetadata = { exchangeAmount: {} }
  const { exchangeAmount = {} } = out

  // Merge the fiat amounts:
  const underAmounts = under.exchangeAmount ?? {}
  const overAmounts = over.exchangeAmount ?? {}
  for (const fiat of Object.keys(underAmounts)) {
    if (overAmounts[fiat] !== null) exchangeAmount[fiat] = underAmounts[fiat]
  }
  for (const fiat of Object.keys(overAmounts)) {
    const amount = overAmounts[fiat]
    if (amount != null) exchangeAmount[fiat] = amount
  }

  // Merge simple fields:
  if (over.bizId !== null) out.bizId = over.bizId ?? under.bizId
  if (over.category !== null) out.category = over.category ?? under.category
  if (over.name !== null) out.name = over.name ?? under.name
  if (over.notes !== null) out.notes = over.notes ?? under.notes

  return out
}

export function upgradeMetadata(
  input: CurrencyWalletInput,
  metadata: EdgeMetadata | EdgeMetadataChange
): void {
  const { fiat = 'iso:USD' } = input.props.walletState
  if (metadata.amountFiat != null) {
    metadata.exchangeAmount = {
      ...metadata.exchangeAmount,
      [fiat]: metadata.amountFiat
    }
  }
}

const asDiskMetadata = asObject({
  bizId: asOptional(asNumber),
  category: asOptional(asString),
  exchangeAmount: asOptional(asObject(asNumber)),
  name: asOptional(asString),
  notes: asOptional(asString)
})
