// @flow

import { base32 } from 'rfc4648'

import { hmacSha1 } from './hashes.js'

export function numberToBe64(number: number): Uint8Array {
  const high = Math.floor(number / 4294967296)
  return new Uint8Array([
    (high >> 24) & 0xff,
    (high >> 16) & 0xff,
    (high >> 8) & 0xff,
    high & 0xff,
    (number >> 24) & 0xff,
    (number >> 16) & 0xff,
    (number >> 8) & 0xff,
    number & 0xff
  ])
}

/**
 * Implements the rfc4226 HOTP specification.
 * @param {*} secret The secret value, K, from rfc4226
 * @param {*} counter The counter, C, from rfc4226
 * @param {*} digits The number of digits to generate
 */
export function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number
): string {
  const hmac = hmacSha1(numberToBe64(counter), secret)

  const offset = hmac[19] & 0xf
  const p =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  const text = p.toString()

  const padding = Array(digits).join('0')
  return (padding + text).slice(-digits)
}

/**
 * Generates an HOTP code based on the current time.
 */
export function totp(
  secret: string | void,
  now: number = Date.now() / 1000
): string | void {
  if (secret == null) return
  return hotp(base32.parse(secret, { loose: true }), now / 30, 6)
}

/**
 * Validates a TOTP code based on the current time,
 * within an adjustable range.
 */
export function checkTotp(
  secret: string,
  otp: string,
  opts: { now?: number, spread?: number } = {}
): boolean {
  const { now = Date.now() / 1000, spread = 1 } = opts
  const index = now / 30
  const secretBytes = base32.parse(secret, { loose: true })

  // Try the middle:
  if (otp === hotp(secretBytes, index, 6)) return true

  // Spiral outwards:
  for (let i = 1; i <= spread; ++i) {
    if (otp === hotp(secretBytes, index - i, 6)) return true
    if (otp === hotp(secretBytes, index + i, 6)) return true
  }
  return false
}

export function fixOtpKey(secret: string): string {
  return base32.stringify(base32.parse(secret, { loose: true }))
}
