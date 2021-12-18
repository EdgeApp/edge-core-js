// @flow

import {
  type EdgeGetTransactionsOptions,
  type EdgeTransaction
} from '../../../types/types.js'

export function dateFilter(
  tx: EdgeTransaction,
  opts: EdgeGetTransactionsOptions
): boolean {
  const { startDate = -Infinity, endDate = Date.now() } = opts

  if (tx.date * 1000 >= startDate && tx.date * 1000 < endDate) return true
  return false
}

export function searchStringFilter(
  tx: EdgeTransaction,
  opts: EdgeGetTransactionsOptions
): boolean {
  const { searchString } = opts

  if (searchString != null && searchString !== '') {
    // Sanitize search string
    let cleanString = searchString
      .toLowerCase()
      .replace('.', '')
      .replace(',', '')
    // Remove leading zeroes
    for (let i = 0; i < cleanString.length; i++) {
      if (cleanString[i] !== '0') {
        cleanString = cleanString.substring(i)
        break
      }
    }

    function checkNullTypeAndIndex(value: string | number): boolean {
      if (
        value == null ||
        (typeof value !== 'string' && typeof value !== 'number')
      )
        return false
      if (
        value
          .toString()
          .toLowerCase()
          .replace('.', '')
          .replace(',', '')
          .indexOf(cleanString) < 0
      )
        return false
      return true
    }

    if (checkNullTypeAndIndex(tx.nativeAmount)) return true
    if (tx.metadata != null) {
      const {
        category = '',
        name = '',
        notes = '',
        exchangeAmount = {}
      } = tx.metadata
      if (
        checkNullTypeAndIndex(category) ||
        checkNullTypeAndIndex(name) ||
        checkNullTypeAndIndex(notes) ||
        (tx.wallet != null &&
          checkNullTypeAndIndex(exchangeAmount[tx.wallet.fiatCurrencyCode]))
      )
        return true
    }
    if (tx.swapData != null && tx.swapData.plugin != null) {
      const { displayName = '', pluginId = '' } = tx.swapData.plugin
      if (checkNullTypeAndIndex(displayName) || checkNullTypeAndIndex(pluginId))
        return true
    }
    if (tx.spendTargets != null) {
      for (const target of tx.spendTargets) {
        const { publicAddress = '', memo = '' } = target
        if (checkNullTypeAndIndex(publicAddress) || checkNullTypeAndIndex(memo))
          return true
      }
    }
    if (tx.ourReceiveAddresses.length > 0) {
      for (const address of tx.ourReceiveAddresses) {
        if (checkNullTypeAndIndex(address)) return true
      }
    }
    if (checkNullTypeAndIndex(tx.txid)) return true
    return false
  }
  return true
}
