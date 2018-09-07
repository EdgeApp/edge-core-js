// These libraries are broken under rollup.js,
// so we have to webpack them before we include them in our bundle.
// This is the webpack entry point.

exports.elliptic = require('elliptic')
exports.hashjs = require('hash.js')
exports.HmacDRBG = require('hmac-drbg')

const Transaction = require('ethereumjs-tx')
const { privateToAddress, toChecksumAddress } = require('ethereumjs-util')

/**
 * This function needs to live inside the webpack bundle
 * to produce the right `Buffer` type.
 */
function hexToBuffer (hex) {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex')
}

exports.ethereumKeyToAddress = function ethereumKeyToAddress (key) {
  const addressBytes = privateToAddress(hexToBuffer(key))
  return toChecksumAddress(addressBytes.toString('hex'))
}

exports.signEthereumTransaction = function signEthereumTransaction (
  ethereumKey,
  transaction
) {
  const tx = new Transaction(transaction)
  tx.sign(hexToBuffer(ethereumKey))
  return tx.serialize().toString('hex')
}
