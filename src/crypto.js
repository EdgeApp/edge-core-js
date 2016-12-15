import aesjs from 'aes-js'
import hashjs from 'hash.js'
import scryptsy from 'scryptsy'

const AesCbc = aesjs.ModeOfOperation.cbc

export const userIdSnrp = {
  'salt_hex': 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  'n': 16384,
  'r': 1,
  'p': 1
}
export const passwordAuthSnrp = userIdSnrp

let timedSnrp = null

let timerNow = null
if (typeof window === 'undefined') {
  timerNow = function () {
    return Date.now()
  }
} else {
  timerNow = function () {
    return window.performance.now()
  }
}

/**
 * @param data A `Buffer` or byte-array object.
 * @param snrp A JSON SNRP structure.
 * @return A Buffer with the hash.
 */
export function scrypt (data, snrp) {
  const dklen = 32
  const salt = new Buffer(snrp.salt_hex, 'hex')
  return scryptsy(data, salt, snrp.n, snrp.r, snrp.p, dklen)
}

export function timeSnrp (snrp) {
  const startTime = timerNow()
  scrypt('random string', snrp)
  const endTime = timerNow()

  return endTime - startTime
}

function calcSnrpForTarget (targetHashTimeMilliseconds) {
  const snrp = {
    'salt_hex': random(32).toString('hex'),
    n: 16384,
    r: 1,
    p: 1
  }
  const timeElapsed = timeSnrp(snrp)

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
}

export function makeSnrp () {
  if (!timedSnrp) {
    // Shoot for a 2s hash time:
    timedSnrp = calcSnrpForTarget(2000)
  }

  // Return a copy of the timed version with a fresh salt:
  return {
    'salt_hex': random(32).toString('hex'),
    'n': timedSnrp.n,
    'r': timedSnrp.r,
    'p': timedSnrp.p
  }
}

export function random (bytes) {
  bytes |= 0
  try {
    var out = new Buffer(bytes)
    window.crypto.getRandomValues(out)
  } catch (e) {
    // Alternative using node.js crypto:
    const hiddenRequire = require
    return hiddenRequire('crypto').randomBytes(bytes)
  }
  return out
}

/**
 * @param box an Airbitz JSON encryption box
 * @param key a key, as an ArrayBuffer
 */
export function decrypt (box, key) {
  // Check JSON:
  if (box['encryptionType'] !== 0) {
    throw new Error('Unknown encryption type')
  }
  const iv = new Buffer(box['iv_hex'], 'hex')
  const cyphertext = new Buffer(box['data_base64'], 'base64')

  // Decrypt:
  const cypher = new AesCbc(key, iv)
  const raw = cypher.decrypt(cyphertext)
  // Alternative using node.js crypto:
  // const decipher = crypto.createDecipheriv('AES-256-CBC', key, iv);
  // let x = decipher.update(box.data_base64, 'base64', 'hex')
  // x += decipher.final('hex')
  // const data = new Buffer(x, 'hex')

  // Calculate field locations:
  const headerSize = raw[0]
  const dataSize =
    raw[1 + headerSize] << 24 |
    raw[2 + headerSize] << 16 |
    raw[3 + headerSize] << 8 |
    raw[4 + headerSize]
  const dataStart = 1 + headerSize + 4
  const footerSize = raw[dataStart + dataSize]
  const hashStart = dataStart + dataSize + 1 + footerSize

  // Verify SHA-256 checksum:
  const hash = hashjs.sha256().update(raw.slice(0, hashStart)).digest()
  const hashSize = hash.length
  for (let i = 0; i < hashSize; ++i) {
    if (raw[hashStart + i] !== hash[i]) {
      throw new Error('Invalid checksum')
    }
  }

  // Verify pkcs7 padding (if any):
  const paddingStart = hashStart + hashSize
  const paddingSize = raw.length - paddingStart
  for (let i = paddingStart; i < raw.length; ++i) {
    if (raw[i] !== paddingSize) {
      throw new Error('Invalid PKCS7 padding')
    }
  }

  // Return the payload:
  return raw.slice(dataStart, dataStart + dataSize)
}

/**
 * @param payload an ArrayBuffer of data
 * @param key a key, as an ArrayBuffer
 */
export function encrypt (data, key) {
  // Calculate sizes and locations:
  const headerSize = random(1)[0] & 0x1f
  const dataStart = 1 + headerSize + 4
  const dataSize = data.length
  const footerStart = dataStart + dataSize + 1
  const footerSize = random(1)[0] & 0x1f
  const hashStart = footerStart + footerSize
  const hashSize = 32
  const paddingStart = hashStart + hashSize
  const paddingSize = 16 - (paddingStart & 0xf)
  const raw = new Buffer(paddingStart + paddingSize)

  // Random header:
  const header = random(headerSize)
  raw[0] = headerSize
  for (let i = 0; i < headerSize; ++i) {
    raw[1 + i] = header[i]
  }

  // Payload data:
  raw[1 + headerSize] = (dataSize >> 24) & 0xff
  raw[2 + headerSize] = (dataSize >> 16) & 0xff
  raw[3 + headerSize] = (dataSize >> 8) & 0xff
  raw[4 + headerSize] = dataSize & 0xff
  for (let i = 0; i < dataSize; ++i) {
    raw[dataStart + i] = data[i]
  }

  // Random footer:
  const footer = random(footerSize)
  raw[dataStart + dataSize] = footerSize
  for (let i = 0; i < footerSize; ++i) {
    raw[footerStart + i] = footer[i]
  }

  // SHA-256 checksum:
  const hash = hashjs.sha256().update(raw.slice(0, hashStart)).digest()
  for (let i = 0; i < hashSize; ++i) {
    raw[hashStart + i] = hash[i]
  }

  // Add PKCS7 padding:
  for (let i = 0; i < paddingSize; ++i) {
    raw[paddingStart + i] = paddingSize
  }

  // Encrypt to JSON:
  const iv = random(16)
  const cypher = new AesCbc(key, iv)
  return {
    'encryptionType': 0,
    'iv_hex': iv.toString('hex'),
    'data_base64': new Buffer(cypher.encrypt(raw)).toString('base64')
  }
}

export function hmacSha256 (data, key) {
  const hmac = hashjs.hmac(hashjs.sha256, key)
  return hmac.update(data).digest()
}
