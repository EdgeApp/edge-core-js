import { EdgeTransaction } from '../../../types/types'
import { ApiInput } from '../../root-pixie'

export function dateFilter(
  tx: EdgeTransaction,
  afterDate: Date = new Date(0),
  beforeDate: Date = new Date()
): boolean {
  return (
    tx.date * 1000 >= afterDate.valueOf() &&
    tx.date * 1000 < beforeDate.valueOf()
  )
}

export function searchStringFilter(
  ai: ApiInput,
  tx: EdgeTransaction,
  searchString: string | undefined
): boolean {
  const currencyState = ai.props.state.currency

  if (searchString == null || searchString === '') return true

  // Sanitize search string
  let cleanString = searchString.toLowerCase().replace('.', '').replace(',', '')
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
      !value
        .toString()
        .toLowerCase()
        .replace('.', '')
        .replace(',', '')
        .includes(cleanString)
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
    const txCurrencyWalletState =
      tx.walletId != null ? currencyState.wallets[tx.walletId] : undefined
    if (
      checkNullTypeAndIndex(category) ||
      checkNullTypeAndIndex(name) ||
      checkNullTypeAndIndex(notes) ||
      (txCurrencyWalletState != null &&
        checkNullTypeAndIndex(exchangeAmount[txCurrencyWalletState.fiat]))
    )
      return true
  }
  if (tx.swapData != null) {
    const { displayName = '', pluginId = '' } = tx.swapData.plugin
    if (checkNullTypeAndIndex(displayName) || checkNullTypeAndIndex(pluginId))
      return true
  }
  if (tx.fiatData != null) {
    const { providerId = '', providerDisplayName = '' } = tx.fiatData.fiatPlugin
    if (
      checkNullTypeAndIndex(providerId) ||
      checkNullTypeAndIndex(providerDisplayName)
    )
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
