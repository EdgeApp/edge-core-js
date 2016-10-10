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
  if (box['encryptionType'] !== 0) {
    throw new Error('Unknown encryption type')
  }

  var iv = new Buffer(box['iv_hex'], 'hex')

  // Step 1: Decrypt
  var cyphertext = new Buffer(box['data_base64'], 'base64')
  var data = new Buffer(asmcrypto.AES_CBC.decrypt(cyphertext, key, true, iv))

  // Alternative using node.js crypto:
  // var decipher = crypto.createDecipheriv('AES-256-CBC', key, iv);
  // var x = decipher.update(box.data_base64, 'base64', 'hex')
  // x += decipher.final('hex')
  // var data = new Buffer(x, 'hex')

  // Step 2: Skip initial padding, then read in size.
  var preSize = data.readUInt8(0)
  var dataSize = data.readUInt32BE(preSize + 1)

  // Step 3: read sha256 and verify?

  var dataStart = preSize + 1 + 4
  return data.slice(dataStart, dataStart + dataSize)
}
exports.decrypt = decrypt

/**
 * @param data an ArrayBuffer of data
 * @param key a key, as an ArrayBuffer
 */
function encrypt (data, key) {
  var out = { 'encryptionType': 0 }

  var iv = random(16)
  out['iv_hex'] = iv.toString('hex')

  var plaintext = new Buffer(data.length + 6 + 32)
  plaintext.writeUInt8(0, 0)
  plaintext.writeUInt32BE(data.length, 1)
  data.copy(plaintext, 5)
  plaintext.writeUInt8(0, data.length + 5)

  var hashData = plaintext.slice(0, data.length + 6)
  var hash = new Buffer(asmcrypto.SHA256.bytes(hashData))
  hash.copy(plaintext, data.length + 6)

  out['data_base64'] = new Buffer(asmcrypto.AES_CBC.encrypt(plaintext, key, true, iv)).toString('base64')

  return out
}
exports.encrypt = encrypt

exports.hmac_sha256 = asmcrypto.HMAC_SHA256.bytes
