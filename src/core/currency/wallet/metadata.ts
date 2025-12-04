import { asNumber, asObject, asOptional, asString, Cleaner } from 'cleaners'

import { EdgeMetadata, EdgeMetadataChange } from '../../../types/types'

export const asEdgeMetadata: Cleaner<EdgeMetadata> = raw => {
  const clean = asDiskMetadata(raw)
  const { exchangeAmount = {} } = clean

  // Delete corrupt amounts that exceed the Javascript number range:
  for (const fiat of Object.keys(exchangeAmount)) {
    if (String(exchangeAmount[fiat]).includes('e')) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
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

/**
 * Checks if metadata is empty (contains no user-added data).
 */
export function isEmptyMetadata(metadata: EdgeMetadata): boolean {
  if (metadata.bizId != null) return false
  if (metadata.category != null && metadata.category !== '') return false
  if (metadata.name != null && metadata.name !== '') return false
  if (metadata.notes != null && metadata.notes !== '') return false
  if (
    metadata.exchangeAmount != null &&
    Object.keys(metadata.exchangeAmount).length > 0
  ) {
    return false
  }
  return true
}

const asDiskMetadata = asObject({
  bizId: asOptional(asNumber),
  category: asOptional(asString),
  exchangeAmount: asOptional(asObject(asNumber)),
  name: asOptional(asString),
  notes: asOptional(asString)
})
