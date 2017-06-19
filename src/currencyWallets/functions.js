import { compare } from '../util/recycle.js'

export function compareTxs (oldTxs = {}, newTxs) {
  const changes = []
  for (const txid of Object.keys(newTxs)) {
    if (!compare(oldTxs[txid], newTxs[txid])) changes.push(newTxs[txid])
  }

  return { changes }
}

export function mergeTxs (txs, files) {
  const out = {}
  for (const txid of Object.keys(txs)) {
    out[txid] = { ...txs[txid], ...files[txid] }
  }
  return out
}
