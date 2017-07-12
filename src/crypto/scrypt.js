import scryptJs from 'scrypt-js'

export const userIdSnrp = {
  salt_hex: 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  n: 16384,
  r: 1,
  p: 1
}
export const passwordAuthSnrp = userIdSnrp

export function scrypt (data, salt, n, r, p, dklen) {
  return new Promise((resolve, reject) => {
    const callback = (error, progress, key) => {
      if (error) return reject(error)
      if (key) return resolve(key)
    }

    scryptJs(data, salt, n, r, p, dklen, callback)
  })
}
