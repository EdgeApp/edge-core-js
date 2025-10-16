import { add, div, lte, sub } from 'biggystring'

import {
  EdgeCurrencyEngine,
  EdgeCurrencyPlugin,
  EdgeSpendInfo,
  EdgeTokenMap,
  EdgeWalletInfo
} from '../../../browser'
import { upgradeCurrencyCode } from '../../../types/type-helpers'
import { upgradeMemos } from './upgrade-memos'

export const getMaxSpendableInner = async (
  spendInfo: EdgeSpendInfo,
  plugin: EdgeCurrencyPlugin,
  engine: EdgeCurrencyEngine,
  allTokens: EdgeTokenMap,
  walletInfo: EdgeWalletInfo
): Promise<string> => {
  spendInfo = upgradeMemos(spendInfo, plugin.currencyInfo)
  // Figure out which asset this is:
  const upgradedCurrency = upgradeCurrencyCode({
    allTokens,
    currencyInfo: plugin.currencyInfo,
    tokenId: spendInfo.tokenId
  })

  const unsafeMakeSpend = plugin.currencyInfo.unsafeMakeSpend ?? false

  if (typeof engine.getMaxSpendable === 'function') {
    // Only provide wallet info if currency requires it:
    const privateKeys = unsafeMakeSpend ? walletInfo.keys : undefined

    return await engine.getMaxSpendable(
      { ...spendInfo, ...upgradedCurrency },
      { privateKeys }
    )
  }

  const { networkFeeOption, customNetworkFee } = spendInfo
  const balance = engine.getBalance(upgradedCurrency)

  // Copy all the spend targets, setting the amounts to 0
  // but keeping all other information so we can get accurate fees:
  const spendTargets = spendInfo.spendTargets.map(spendTarget => {
    return { ...spendTarget, nativeAmount: '0' }
  })

  // The range of possible values includes `min`, but not `max`.
  function getMax(min: string, max: string): Promise<string> {
    const diff = sub(max, min)
    if (lte(diff, '1')) {
      return Promise.resolve(min)
    }
    const mid = add(min, div(diff, '2'))

    // Try the average:
    spendTargets[0].nativeAmount = mid

    // Only provide wallet info if currency requires it:
    const privateKeys = unsafeMakeSpend ? walletInfo.keys : undefined

    return engine
      .makeSpend(
        {
          ...upgradedCurrency,
          spendTargets,
          networkFeeOption,
          customNetworkFee,
          // Include memos & otherParams to accurately price other factors that
          // may impact the fee (e.g. OP_RETURN).
          memos: spendInfo.memos,
          otherParams: spendInfo.otherParams
        },
        { privateKeys }
      )
      .then(() => getMax(mid, max))
      .catch(() => getMax(min, mid))
  }

  return await getMax('0', add(balance, '1'))
}
