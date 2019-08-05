// @flow

import baseX from 'base-x'
import utf8Codec from 'utf8'

const base58Codec = baseX(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
)

function assertString(text) {
  if (typeof text !== 'string') {
    throw new Error('Input is not a string')
  }
}

function assertData(data) {
  if (typeof data === 'string' || data.length == null) {
    throw new Error('Input is not data')
  }
}

export const base58 = {
  parse(text: string): Uint8Array {
    assertString(text)
    return base58Codec.decode(text)
  },
  stringify(data: Uint8Array | Array<number>): string {
    assertData(data)
    return base58Codec.encode(data)
  }
}

export const utf8 = {
  parse(text: string): Uint8Array {
    const byteString: string = utf8Codec.encode(text)
    const out = new Uint8Array(byteString.length)

    for (let i = 0; i < byteString.length; ++i) {
      out[i] = byteString.charCodeAt(i)
    }

    return out
  },

  stringify(data: Uint8Array | Array<number>): string {
    assertData(data)

    // Some of our data contains terminating null bytes due to an old bug.
    // We need to filter that out here:
    const length = data[data.length - 1] === 0 ? data.length - 1 : data.length

    let byteString = ''
    for (let i = 0; i < length; ++i) {
      byteString += String.fromCharCode(data[i])
    }

    return utf8Codec.decode(byteString)
  }
}
