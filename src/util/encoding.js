import baseX from 'base-x'
import {Buffer} from 'buffer'
const base58Codec = baseX('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz')

function assertString (text) {
  if (typeof text !== 'string') {
    throw new Error('Input is not a string')
  }
}

function assertData (data) {
  if (typeof data === 'string' || data.length == null) {
    throw new Error('Input is not data')
  }
}

export const base16 = {
  parse (text) {
    assertString(text)
    return new Buffer(text, 'hex')
  },
  stringify (data) {
    assertData(data)
    return new Buffer(data).toString('hex')
  }
}

export const base58 = {
  parse (text) {
    assertString(text)
    return new Buffer(base58Codec.decode(text))
  },
  stringify (data) {
    assertData(data)
    return base58Codec.encode(data)
  }
}

export const base64 = {
  parse (text) {
    assertString(text)
    return new Buffer(text, 'base64')
  },
  stringify (data) {
    assertData(data)
    return new Buffer(data).toString('base64')
  }
}

export const utf8 = {
  parse (text) {
    assertString(text)
    return new Buffer(text, 'utf8')
  },
  stringify (data) {
    assertData(data)
    return new Buffer(data).toString('utf8')
  }
}
