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

export function getCurrencyWalletProgress (state, keyId) {
  return state.currencyWallets[keyId].progress
}

// Transaction list:
export const getCurrencyWalletTxs = deriveSelector(
  (state, keyId) => [
    state.currencyWallets[keyId].txs,
    state.currencyWallets[keyId].files
  ],
  (txs, files) => {
    const out = {}
    for (const txid of Object.keys(txs)) {
      out[txid] = { metadata: {}, ...txs[txid], ...files[txid] }
    }
    return out
  }
)
