import baseX from 'base-x'
const base58Codec = baseX('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')

function base58Decode (text) {
  return new Buffer(base58Codec.decode(text))
}

function base58Encode (data) {
  return base58Codec.encode(data)
}

export const base58 = {
  decode: base58Decode,
  encode: base58Encode
}
