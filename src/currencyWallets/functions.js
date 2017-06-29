export function mergeTxs (txs, files) {
  const out = {}
  for (const txid of Object.keys(txs)) {
    out[txid] = { ...txs[txid], ...files[txid] }
  }
  return out
}
