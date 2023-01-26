import scryptJs from 'scrypt-js'

export function scrypt(
  data: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  dklen: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // The scrypt library will crash if it gets a Uint8Array > 64 bytes:
    const copy: number[] = []
    for (let i = 0; i < data.length; ++i) copy[i] = data[i]

    scryptJs(copy, salt, n, r, p, dklen, (error, progress, key) => {
      if (error != null) return reject(error)
      if (key != null) return resolve(Uint8Array.from(key))
    })
  })
}
