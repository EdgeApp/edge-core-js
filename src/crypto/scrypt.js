import {serialize} from '../util/decorators.js'
import {base16, utf8} from '../util/encoding.js'
import scryptJs from 'scrypt-js'

export const userIdSnrp = {
  'salt_hex': 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  'n': 16384,
  'r': 1,
  'p': 1
}
export const passwordAuthSnrp = userIdSnrp

// Holds a `Promise` of an SRNP:
let snrpCache = null

let timerNow = null
if (typeof window !== 'undefined' && window.performance) {
  timerNow = function () {
    return window.performance.now()
  }
} else {
  timerNow = function () {
    return Date.now()
  }
}

/**
 * @param data A string to hash.
 * @param snrp A JSON SNRP structure.
 * @return A promise for an object with the hash and elapsed time.
 */
const timeScrypt = serialize(function timeScrypt (data, snrp) {
  const dklen = 32
  const salt = base16.decode(snrp.salt_hex)
  if (typeof data === 'string') {
    data = utf8.encode(data)
  }
  return new Promise((resolve, reject) => {
    const startTime = timerNow()
    scryptJs(data, salt, snrp.n, snrp.r, snrp.p, dklen, (error, progress, key) => {
      if (error) return reject(error)
      if (key) {
        return resolve({
          hash: key,
          time: timerNow() - startTime
        })
      }
    })
  })
})

export function scrypt (data, snrp) {
  return timeScrypt(data, snrp).then(value => value.hash)
}

function calcSnrpForTarget (io, targetHashTimeMilliseconds) {
  const snrp = {
    'salt_hex': userIdSnrp.salt_hex,
    'n': 16384,
    'r': 1,
    'p': 1
  }

  return timeScrypt('', snrp).then(value => {
    const timeElapsed = value.time
    let estTargetTimeElapsed = timeElapsed
    let nUnPowered = 0
    const r = (targetHashTimeMilliseconds / estTargetTimeElapsed)
    if (r > 8) {
      snrp.r = 8

      estTargetTimeElapsed *= 8
      const n = (targetHashTimeMilliseconds / estTargetTimeElapsed)

      if (n > 4) {
        nUnPowered = 4

        estTargetTimeElapsed *= 4
        const p = (targetHashTimeMilliseconds / estTargetTimeElapsed)
        snrp.p = Math.floor(p)
      } else {
        nUnPowered = Math.floor(n)
      }
    } else {
      snrp.r = r > 4 ? Math.floor(r) : 4
    }
    nUnPowered = nUnPowered >= 1 ? nUnPowered : 1
    snrp.n = Math.pow(2, nUnPowered + 13)

    io.log.info(`snrp: ${snrp.n} ${snrp.r} ${snrp.p} based on ${timeElapsed}ms benchmark`)
    return snrp
  })
}

export function makeSnrp (io) {
  // Put the calculation in the cache if it isn't already started:
  if (!snrpCache) {
    snrpCache = calcSnrpForTarget(io, 2000)
  }

  // Return a copy of the timed version with a fresh salt:
  return snrpCache.then(snrp => ({
    'salt_hex': base16.encode(io.random(32)),
    'n': snrp.n,
    'r': snrp.r,
    'p': snrp.p
  }))
}
