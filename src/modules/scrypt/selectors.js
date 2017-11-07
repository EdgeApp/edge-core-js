import { base16 } from '../../util/encoding.js'

export function calcSnrpForTarget (salt, benchMs, targetMs) {
  console.log(
    'calcSnrpForTarget:' + benchMs.toString() + ' ' + targetMs.toString()
  )
  const snrp = {
    salt_hex: base16.stringify(salt),
    n: 16384,
    r: 8,
    p: 1
  }

  if (benchMs === 0) {
    snrp.n = 131072
    snrp.r = 8
    snrp.p = 64
    return snrp
  }

  let timeUsed = benchMs // Estimated time in ms the current setting will take on current device

  //
  // Add additional r value first. This increases memory usage
  // Each additional increment of 'r' is approximately a linear increase in time.
  //
  const STARTING_R = 8
  const MAX_R = 8
  const REMAINING_R = MAX_R - STARTING_R
  const perRValue = benchMs / STARTING_R // The amount of ms delay each increment of 'r' creates
  let addR = (targetMs - timeUsed) / perRValue
  addR = addR > 0 ? addR : 0
  if (addR > REMAINING_R) {
    addR = REMAINING_R
  }
  addR = Math.floor(addR)
  snrp.r = STARTING_R + addR
  timeUsed += addR * perRValue
  console.log(
    '   perRValue: ' +
      perRValue.toString() +
      ' addR:' +
      addR.toString() +
      ' timeUsed:' +
      timeUsed.toString()
  )

  //
  // Add additional N value in powers of 2. Each power of 2 doubles the amount of time it takes
  // to calculate the hash
  //
  let nPow = 14 // 2^14 = 16384 which is the minimum safe N value

  // Iteratively calculate the amount of additional N values we can add
  // Max out at N = 17
  let addN = (targetMs - timeUsed) / timeUsed
  addN = addN > 0 ? addN : 0
  if (addN > 3) {
    addN = 3
  }
  addN = Math.floor(addN)
  nPow += addN >= 0 ? addN : 0
  timeUsed += addN * timeUsed

  snrp.n = Math.pow(2, nPow)
  console.log(
    '   addN: ' + addN.toString() + ' timeUsed:' + timeUsed.toString()
  )

  //
  // Add additional p value which increases parallelization factor
  // Max out at p = 64
  //
  let addP = (targetMs - timeUsed) / timeUsed
  addP = addP > 0 ? addP : 0
  if (addP > 64) {
    addP = 64
  }
  addP = Math.floor(addP)
  snrp.p = addP >= 1 ? addP : 1
  timeUsed += addP * timeUsed
  console.log(
    '   addP: ' + addP.toString() + ' timeUsed:' + timeUsed.toString()
  )

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
    scrypt.benchmark = scrypt.timeScrypt('1reallyJunkiePasswordToCheck', {
      salt_hex:
        'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
      n: 16384,
      r: 8,
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
