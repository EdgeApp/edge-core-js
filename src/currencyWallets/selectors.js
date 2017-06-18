export function getCurrencyWallet (state, keyId) {
  return state[keyId]
}

export function getCurrencyWalletName (currencyWallet) {
  return currencyWallet.name
}
