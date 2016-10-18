var baseX = require('base-x')
var base58 = baseX('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')

function base58Decode (text) {
  return new Buffer(base58.decode(text))
}

function base58Encode (data) {
  return base58.encode(data)
}

exports.base58 = {
  decode: base58Decode,
  encode: base58Encode
}
