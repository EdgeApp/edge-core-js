export function getCurrencyWalletEngine (state, keyId) {
  return state.currencyWallets[keyId].engine
}

export function getCurrencyWalletName (state, keyId) {
  return state.currencyWallets[keyId].name
}

export function getCurrencyWalletPlugin (state, keyId) {
  return state.currencyWallets[keyId].plugin
}

export function getCurrencyWalletTxs (state, keyId) {
  return state.currencyWallets[keyId].txs
}

export function getCurrencyWalletFiles (state, keyId) {
  return state.currencyWallets[keyId].files
}

export function getStorageWallet (state, keyId) {
  return state.currencyWallets[keyId].storage
}
