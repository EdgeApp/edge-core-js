import baseX from 'base-x'
const base58Codec = baseX('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')

export const base16 = {
  decode (text) {
    return new Buffer(text, 'hex')
  },
  encode (data) {
    return new Buffer(data).toString('hex')
  }
}

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

export const base64 = {
  decode (text) {
    return new Buffer(text, 'base64')
  },
  encode (data) {
    return new Buffer(data).toString('base64')
  }
}

export const utf8 = {
  decode (data) {
    return new Buffer(data).toString('utf8')
  },
  encode (text) {
    return new Buffer(text, 'utf8')
  }
}
