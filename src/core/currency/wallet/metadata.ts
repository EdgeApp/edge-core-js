import { asNumber, asObject, asOptional, asString, Cleaner } from 'cleaners'

import { EdgeMetadata } from '../../../types/types'
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
  over: EdgeMetadata
): EdgeMetadata {
  return {
    exchangeAmount: {
      ...under.exchangeAmount,
      ...over.exchangeAmount
    },
    bizId: over.bizId ?? under.bizId,
    category: over.category ?? under.category,
    name: over.name ?? under.name,
    notes: over.notes ?? under.notes
  }
}

export function upgradeMetadata(
  input: CurrencyWalletInput,
  metadata: EdgeMetadata
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
