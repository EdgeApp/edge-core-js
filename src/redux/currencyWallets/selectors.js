import { deriveSelector } from '../../util/derive.js'

// Basic wallet functionality:
export function getCurrencyWalletEngine (state, keyId) {
  return state.currencyWallets[keyId].engine
}

export function getCurrencyWalletPlugin (state, keyId) {
  return state.currencyWallets[keyId].plugin
}

// Settable values:

export function getCurrencyWalletBalance (state, keyId) {
  return state.currencyWallets[keyId].balance
}

export function getCurrencyWalletBlockHeight (state, keyId) {
  return state.currencyWallets[keyId].blockHeight
}

export function getCurrencyWalletName (state, keyId) {
  return state.currencyWallets[keyId].name
}

export function getCurrencyWalletFiat (state, keyId) {
  return 'iso:USD'
}

export function getCurrencyWalletFile (state, keyId, txid) {
  return state.currencyWallets[keyId].files[txid]
}

export function getCurrencyWalletProgress (state, keyId) {
  return state.currencyWallets[keyId].progress
}

// Transactions:

export function getCurrencyWalletFiles (state, keyId) {
  return state.currencyWallets[keyId].files
}

/**
 * Returns a list of `{ txid?: string, filename?: string, date?: number }`.
 * TODO: Merge our file list with the plugin txid list.
 */
export const getCurrencyWalletTxList = deriveSelector(
  (state, keyId) => [state.currencyWallets[keyId].txs],
  txs => Object.keys(txs).map(txid => ({ txid }))
)

export function getCurrencyWalletTxs (state, keyId) {
  return state.currencyWallets[keyId].txs
}
