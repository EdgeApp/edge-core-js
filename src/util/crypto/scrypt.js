// @flow

import scryptJs from 'scrypt-js'

export const userIdSnrp = {
  salt_hex: 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  n: 16384,
  r: 1,
  p: 1
}
export const passwordAuthSnrp = userIdSnrp

export function scrypt (
  data: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  dklen: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const callback = (error, progress, key) => {
      if (error) return reject(error)
      if (key) return resolve(key)
    }

    // The scrypt library will crash if it gets a Uint8Array > 64 bytes:
    const copy = []
    for (let i = 0; i < data.length; ++i) copy[i] = data[i]

    scryptJs(copy, salt, n, r, p, dklen, callback)
  })
}
