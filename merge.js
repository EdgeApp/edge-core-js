const _syncTxs = [
  { time: 100, txid: 'a' },
  { time: 99, txid: 'b' },
  { time: 97, txid: 'd' },
  { time: 96, txid: 'e' },
  { time: 70, txid: 'c' },
  { time: 68, txid: 'h' },
  { time: 57, txid: 'f' },
  { time: 56, txid: 'g' }
]

const _pluginTxs = [
  { time: 100, txid: 'a' },
  { time: 99, txid: 'b' },
  { time: 98, txid: 'c' },
  { time: 96, txid: 'e' },
  { time: 93, txid: 'h' },
  { time: 69, txid: 'd' },
  { time: 55, txid: 'g' },
  { time: 50, txid: 'f' }
]

const arrayToMap = a => {
  const out = {}
  for (let i = 0; i < a.length; i++) {
    out[a[i].txid] = {
      idx: i,
      time: a[i].time,
      txid: a[i].txid
    }
  }
  return out
}

const createOut = (a, b) => {
  return {
    time: a.time < b.time ? a.time : b.time,
    txid: a.txid
  }
}

const merge = (sync, plug) => {
  console.log(sync)
  console.log(plug)
  const syncMap = arrayToMap(sync)
  const plugMap = arrayToMap(plug)
  console.log(syncMap)
  console.log(plugMap)
  const out = []
  let o = 0
  let p = 0
  let s = 0
  do {
    let ss = sync[s]
    let pp = plug[p]
    if (!ss) ss = { txid: 'notxid', time: -1 }
    if (!pp) pp = { txid: 'notxid', time: -1 }
    if (ss.txid === pp.txid) {
      out[o++] = createOut(ss, pp)
      p++
      s++
    } else if (ss.time > pp.time) {
      // Check if merged
      if (syncMap[ss.txid].merged) {
        out[o++] = ss
        s++
      } else {
        // Merge
        plugMap[ss.txid].merged = true
        s++
      }
    } else {
      // Check if merged
      if (plugMap[pp.txid].merged) {
        out[o++] = pp
        p++
      } else {
        // Merge
        syncMap[pp.txid].merged = true
        p++
      }
    }
  } while (p < plug.length || s < s.length)
  return out
}

console.log(merge(_syncTxs, _pluginTxs))
