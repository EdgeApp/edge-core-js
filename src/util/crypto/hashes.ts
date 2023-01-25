import hashjs from 'hash.js'

export function hmacSha1(data: Uint8Array, key: Uint8Array): Uint8Array {
  const hmac = hashjs.hmac(hashjs.sha1, key)
  return Uint8Array.from(hmac.update(data).digest())
}

export function hmacSha256(data: Uint8Array, key: Uint8Array): Uint8Array {
  const hmac = hashjs.hmac(hashjs.sha256, key)
  return Uint8Array.from(hmac.update(data).digest())
}

export function hmacSha512(data: Uint8Array, key: Uint8Array): Uint8Array {
  const hmac = hashjs.hmac(hashjs.sha512, key)
  return Uint8Array.from(hmac.update(data).digest())
}

export function sha256(data: Uint8Array): Uint8Array {
  const hash = hashjs.sha256()
  return Uint8Array.from(hash.update(data).digest())
}
