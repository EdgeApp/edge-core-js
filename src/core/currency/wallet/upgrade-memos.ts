import { EdgeCurrencyInfo, EdgeMemo, EdgeSpendInfo } from '../../../types/types'

/**
 * Upgrades the memo fields inside an EdgeSpendTarget,
 * so any combination of legacy or modern apps or plugins will work.
 */
export function upgradeMemos(
  spendInfo: EdgeSpendInfo,
  currencyInfo: EdgeCurrencyInfo
): EdgeSpendInfo {
  const legacyMemos: EdgeMemo[] = []

  // If this chain supports legacy memos, grab those:
  const { memoType } = currencyInfo
  if (memoType === 'hex' || memoType === 'number' || memoType === 'text') {
    for (const target of spendInfo.spendTargets) {
      if (target.memo != null) {
        legacyMemos.push({
          type: memoType,
          value: target.memo
        })
      } else if (target.uniqueIdentifier != null) {
        legacyMemos.push({
          type: memoType,
          value: target.uniqueIdentifier
        })
      } else if (typeof target.otherParams?.uniqueIdentifier === 'string') {
        legacyMemos.push({
          type: memoType,
          value: target.otherParams.uniqueIdentifier
        })
      }
    }
  }

  // We need to support 0x prefixes for backwards compatibility:
  for (const memo of legacyMemos) {
    if (memo.type === 'hex') memo.value = memo.value.replace(/^0x/i, '')
  }

  // Make a modern, legacy-free spend target:
  const out: EdgeSpendInfo = {
    ...spendInfo,

    // Delete any legacy memo fields:
    spendTargets: spendInfo.spendTargets.map(target => ({
      ...target,
      memo: undefined,
      uniqueIdentifier: undefined
    })),

    // Only use the legacy memos if new ones are missing:
    memos: spendInfo.memos ?? legacyMemos
  }

  // If we have exactly one memo, copy it to the legacy fields
  // to support out-dated currency plugins:
  if (out.memos?.length === 1 && out.spendTargets.length >= 1) {
    const [memo] = out.memos
    if (memo.type === currencyInfo.memoType) {
      const [target] = out.spendTargets
      target.memo = memo.value
      target.uniqueIdentifier = memo.value
      target.otherParams = {
        ...target.otherParams,
        uniqueIdenfitifer: memo.value
      }
    }
  }

  return out
}
