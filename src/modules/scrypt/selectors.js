import { base16 } from '../../util/encoding.js'

export function calcSnrpForTarget (salt, benchMs, targetMs) {
  const snrp = {
    salt_hex: base16.stringify(salt),
    n: 16384,
    r: 1,
    p: 1
  }

  if (benchMs === 0) {
    snrp.n = 131072
    snrp.r = 8
    snrp.p = 64
    return snrp
  }

  let estTargetTimeElapsed = benchMs
  let nUnPowered = 0
  const r = targetMs / estTargetTimeElapsed
  if (r > 8) {
    snrp.r = 8

    estTargetTimeElapsed *= 8
    const n = targetMs / estTargetTimeElapsed

    if (n > 4) {
      nUnPowered = 4

      estTargetTimeElapsed *= 4
      const p = targetMs / estTargetTimeElapsed
      snrp.p = Math.floor(p)
    } else {
      nUnPowered = Math.floor(n)
    }
  } else {
    snrp.r = r > 4 ? Math.floor(r) : 4
  }
  nUnPowered = nUnPowered >= 1 ? nUnPowered : 1
  snrp.n = Math.pow(2, nUnPowered + 13)

  return snrp
}

/**
 * Performs an scrypt derivation.
 */
export function scrypt (state, data, snrp) {
  return state.scrypt.timeScrypt(data, snrp).then(value => value.hash)
}

/**
 * Computes an SNRP value.
 */
export function makeSnrp (state, targetMs = 2000) {
  const { io, scrypt } = state

  // Run the benchmark.
  // Writing directly to Redux would normally be a big no-no,
  // but memoization is "state" in the normal sense:
  if (scrypt.benchmark == null) {
    scrypt.benchmark = scrypt.timeScrypt('', {
      salt_hex: '00000000000000000000000000000000',
      n: 16384,
      r: 1,
      p: 1
    })
  }

  // Calculate an SNRP value:
  return scrypt.benchmark.then(value => {
    const benchMs = value.time

    const snrp = calcSnrpForTarget(io.random(32), benchMs, targetMs)
    io.console.info(
      `snrp: ${snrp.n} ${snrp.r} ${snrp.p} based on ${benchMs}ms benchmark`
    )
    return snrp
  })
}

export const userIdSnrp = {
  salt_hex: 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  n: 16384,
  r: 1,
  p: 1
}
