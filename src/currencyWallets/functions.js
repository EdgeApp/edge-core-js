export function compareTxs (oldTxs = {}, newTxs) {
  const changes = []
  for (const txid of Object.keys(newTxs)) {
    if (oldTxs[txid] !== newTxs[txid]) changes.push(newTxs[txid])
  }

  return {changes}
}
