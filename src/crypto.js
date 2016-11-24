var AesCbc = require('aes-js').ModeOfOperation.cbc
var scryptsy = require('scryptsy')
var asmcrypto = require('./asmcrypto/asmcrypto.js')

var userIdSnrp = {
  'salt_hex': 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  'n': 16384,
  'r': 1,
  'p': 1
}
exports.userIdSnrp = userIdSnrp
exports.passwordAuthSnrp = userIdSnrp

var timedSnrp = null

var timerNow
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
function scrypt (data, snrp) {
  var dklen = 32
  var salt = new Buffer(snrp.salt_hex, 'hex')
  return scryptsy(data, salt, snrp.n, snrp.r, snrp.p, dklen)
}
exports.scrypt = scrypt

function timeSnrp (snrp) {
  var startTime = 0
  var endTime = 0
  startTime = timerNow()

  scrypt('random string', snrp)

  endTime = timerNow()

  var timeElapsed = endTime - startTime
  return timeElapsed
}

exports.timeSnrp = timeSnrp

function calcSnrpForTarget (targetHashTimeMilliseconds) {
  var snrp = {
    'salt_hex': random(32).toString('hex'),
    n: 16384,
    r: 1,
    p: 1
  }
  var timeElapsed = timeSnrp(snrp)

  var estTargetTimeElapsed = timeElapsed
  var nUnPowered = 0
  var r = (targetHashTimeMilliseconds / estTargetTimeElapsed)
  if (r > 8) {
    snrp.r = 8

    estTargetTimeElapsed *= 8
    var n = (targetHashTimeMilliseconds / estTargetTimeElapsed)

    if (n > 4) {
      nUnPowered = 4

      estTargetTimeElapsed *= 4
      var p = (targetHashTimeMilliseconds / estTargetTimeElapsed)
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
  // var newTimeElapsed = timeSnrp(snrp)
  // console.log('timedSnrp: ' + snrp.n + ' ' + snrp.r + ' ' + snrp.p + ' oldTime:' + timeElapsed + ' newTime:' + newTimeElapsed)
  console.log('timedSnrp: ' + snrp.n + ' ' + snrp.r + ' ' + snrp.p + ' oldTime:' + timeElapsed)

  return snrp
}

function makeSnrp () {
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
exports.makeSnrp = makeSnrp

function random (bytes) {
  bytes |= 0
  try {
    var out = new Buffer(bytes)
    window.crypto.getRandomValues(out)
  } catch (e) {
    // Alternative using node.js crypto:
    var hiddenRequire = require
    return hiddenRequire('crypto').randomBytes(bytes)
  }
  return out
}
exports.random = random

/**
 * @param box an Airbitz JSON encryption box
 * @param key a key, as an ArrayBuffer
 */
function decrypt (box, key) {
  // Check JSON:
  if (box['encryptionType'] !== 0) {
    throw new Error('Unknown encryption type')
  }
  var iv = new Buffer(box['iv_hex'], 'hex')
  var cyphertext = new Buffer(box['data_base64'], 'base64')

  // Decrypt:
  var cypher = new AesCbc(key, iv)
  var raw = cypher.decrypt(cyphertext)
  // Alternative using node.js crypto:
  // var decipher = crypto.createDecipheriv('AES-256-CBC', key, iv);
  // var x = decipher.update(box.data_base64, 'base64', 'hex')
  // x += decipher.final('hex')
  // var data = new Buffer(x, 'hex')

  // Calculate field locations:
  var headerSize = raw[0]
  var dataSize =
    raw[1 + headerSize] << 24 |
    raw[2 + headerSize] << 16 |
    raw[3 + headerSize] << 8 |
    raw[4 + headerSize]
  var dataStart = 1 + headerSize + 4
  var footerSize = raw[dataStart + dataSize]
  var hashStart = dataStart + dataSize + 1 + footerSize

  // Verify SHA-256 checksum:
  var hash = asmcrypto.SHA256.bytes(raw.slice(0, hashStart))
  var hashSize = hash.length
  for (let i = 0; i < hashSize; ++i) {
    if (raw[hashStart + i] !== hash[i]) {
      throw new Error('Invalid checksum')
    }
  }

  // Verify pkcs7 padding (if any):
  var paddingStart = hashStart + hashSize
  var paddingSize = raw.length - paddingStart
  for (let i = paddingStart; i < raw.length; ++i) {
    if (raw[i] !== paddingSize) {
      throw new Error('Invalid PKCS7 padding')
    }
  }

  // Return the payload:
  return raw.slice(dataStart, dataStart + dataSize)
}
exports.decrypt = decrypt

/**
 * @param payload an ArrayBuffer of data
 * @param key a key, as an ArrayBuffer
 */
function encrypt (data, key) {
  // Calculate sizes and locations:
  var headerSize = random(1)[0] & 0x1f
  var dataStart = 1 + headerSize + 4
  var dataSize = data.length
  var footerStart = dataStart + dataSize + 1
  var footerSize = random(1)[0] & 0x1f
  var hashStart = footerStart + footerSize
  var hashSize = 32
  var paddingStart = hashStart + hashSize
  var paddingSize = 16 - (paddingStart & 0xf)
  var raw = new Buffer(paddingStart + paddingSize)

  // Random header:
  var header = random(headerSize)
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
  var footer = random(footerSize)
  raw[dataStart + dataSize] = footerSize
  for (let i = 0; i < footerSize; ++i) {
    raw[footerStart + i] = footer[i]
  }

  // SHA-256 checksum:
  var hash = asmcrypto.SHA256.bytes(raw.slice(0, hashStart))
  for (let i = 0; i < hashSize; ++i) {
    raw[hashStart + i] = hash[i]
  }

  // Add PKCS7 padding:
  for (let i = 0; i < paddingSize; ++i) {
    raw[paddingStart + i] = paddingSize
  }

  // Encrypt to JSON:
  var iv = random(16)
  var cypher = new AesCbc(key, iv)
  return {
    'encryptionType': 0,
    'iv_hex': iv.toString('hex'),
    'data_base64': new Buffer(cypher.encrypt(raw)).toString('base64')
  }
}
exports.encrypt = encrypt

function hmacSha256 (data, key) {
  return asmcrypto.HMAC_SHA256.bytes(data, key)
}
exports.hmacSha256 = hmacSha256
