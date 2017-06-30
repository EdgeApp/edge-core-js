import { deriveSelector } from '../../util/derive.js'

export function getCurrencyWalletEngine (state, keyId) {
  return state.currencyWallets[keyId].engine
}

export function getCurrencyWalletName (state, keyId) {
  return state.currencyWallets[keyId].name
}

export function getCurrencyWalletPlugin (state, keyId) {
  return state.currencyWallets[keyId].plugin
}

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
