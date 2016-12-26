import {serialize} from '../util/decorators.js'
import {random} from './crypto.js'
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
 * @param data A `Buffer` or byte-array object.
 * @param snrp A JSON SNRP structure.
 * @return A promise for an object with the hash and elapsed time.
 */
const timeScrypt = serialize(function timeScrypt (data, snrp) {
  const dklen = 32
  const salt = new Buffer(snrp.salt_hex, 'hex')
  if (typeof data === 'string') {
    data = new Buffer(data, 'utf-8')
  }
  return new Promise((resolve, reject) => {
    const startTime = timerNow()
    scryptJs(data, salt, snrp.n, snrp.r, snrp.p, dklen, (error, progress, key) => {
      if (error) return reject(error)
      if (key) {
        return resolve({
          hash: new Buffer(key),
          time: timerNow() - startTime
        })
      }
    })
  })
})

export function scrypt (data, snrp) {
  return timeScrypt(data, snrp).then(value => value.hash)
}

function calcSnrpForTarget (targetHashTimeMilliseconds) {
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

    // Actually time the new snrp:
    // const newTimeElapsed = timeSnrp(snrp)
    // console.log('timedSnrp: ' + snrp.n + ' ' + snrp.r + ' ' + snrp.p + ' oldTime:' + timeElapsed + ' newTime:' + newTimeElapsed)
    console.log('timedSnrp: ' + snrp.n + ' ' + snrp.r + ' ' + snrp.p + ' oldTime:' + timeElapsed)

    return snrp
  })
}

export function makeSnrp () {
  // Put the calculation in the cache if it isn't already started:
  if (!snrpCache) {
    snrpCache = calcSnrpForTarget(2000)
  }

  // Return a copy of the timed version with a fresh salt:
  return snrpCache.then(snrp => ({
    'salt_hex': random(32).toString('hex'),
    'n': snrp.n,
    'r': snrp.r,
    'p': snrp.p
  }))
}
