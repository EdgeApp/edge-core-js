import baseX from 'base-x'
import {Buffer} from 'buffer'
const base58Codec = baseX('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')

export const base16 = {
  parse (text) {
    return new Buffer(text, 'hex')
  },
  stringify (data) {
    return new Buffer(data).toString('hex')
  }
}

export const base58 = {
  parse (text) {
    return new Buffer(base58Codec.decode(text))
  },
  stringify (data) {
    return base58Codec.encode(data)
  }
}

export const base64 = {
  parse (text) {
    return new Buffer(text, 'base64')
  },
  stringify (data) {
    return new Buffer(data).toString('base64')
  }
}

export const utf8 = {
  parse (text) {
    return new Buffer(text, 'utf8')
  },
  stringify (data) {
    return new Buffer(data).toString('utf8')
  }
}
