export function getCurrencyWallet (state, keyId) {
  return state[keyId]
}

export function getEngine (currencyWallet) {
  return currencyWallet.engine
}

export function getName (currencyWallet) {
  return currencyWallet.name
}

export function getPlugin (currencyWallet) {
  return currencyWallet.plugin
}

export function getTxs (currencyWallet) {
  return currencyWallet.txs
}
