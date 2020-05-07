// @flow

import aesjs from 'aes-js'
import { base16, base64 } from 'rfc4648'

import { type EdgeIo } from '../../types/types.js'
import { utf8 } from '../encoding.js'
import { sha256 } from './hashes.js'
import { verifyData } from './verify.js'

const AesCbc = aesjs.ModeOfOperation.cbc

export type EdgeBox = {
  encryptionType: number,
  data_base64: string,
  iv_hex: string
}

/**
 * Some of our data contains terminating null bytes due to an old bug,
 * so this function handles text decryption as a special case.
 */
export function decryptText(box: EdgeBox, key: Uint8Array): string {
  const data = decrypt(box, key)
  if (data[data.length - 1] === 0) {
    return utf8.stringify(data.subarray(0, -1))
  }
  return utf8.stringify(data)
}

/**
 * @param box an Airbitz JSON encryption box
 * @param key a key, as an ArrayBuffer
 */
export function decrypt(box: EdgeBox, key: Uint8Array): Uint8Array {
  // Check JSON:
  if (box.encryptionType !== 0) {
    throw new Error('Unknown encryption type')
  }
  const iv = base16.parse(box.iv_hex)
  const ciphertext = base64.parse(box.data_base64)

  // Decrypt:
  const cipher = new AesCbc(key, iv)
  const raw = cipher.decrypt(ciphertext)

  // Calculate data locations:
  const headerStart = 1
  const headerSize = raw[0]
  const dataStart = headerStart + headerSize + 4
  const dataSize =
    (raw[dataStart - 4] << 24) |
    (raw[dataStart - 3] << 16) |
    (raw[dataStart - 2] << 8) |
    raw[dataStart - 1]
  const footerStart = dataStart + dataSize + 1
  const footerSize = raw[footerStart - 1]
  const hashStart = footerStart + footerSize
  const paddingStart = hashStart + 32

  // Verify SHA-256 checksum:
  const hash = sha256(raw.subarray(0, hashStart))
  if (!verifyData(hash, raw.subarray(hashStart, paddingStart))) {
    throw new Error('Invalid checksum')
  }

  // Verify pkcs7 padding:
  const padding = pkcs7(paddingStart)
  if (!verifyData(padding, raw.subarray(paddingStart))) {
    throw new Error('Invalid PKCS7 padding')
  }

  // Return the payload:
  return raw.subarray(dataStart, dataStart + dataSize)
}

/**
 * @param payload an ArrayBuffer of data
 * @param key a key, as an ArrayBuffer
 */
export function encrypt(
  io: EdgeIo,
  data: Uint8Array,
  key: Uint8Array
): EdgeBox {
  // Calculate data locations:
  const headerStart = 1
  const headerSize = io.random(1)[0] & 0x1f
  const dataStart = headerStart + headerSize + 4
  const dataSize = data.length
  const footerStart = dataStart + dataSize + 1
  const footerSize = io.random(1)[0] & 0x1f
  const hashStart = footerStart + footerSize
  const paddingStart = hashStart + 32

  // Initialize the buffer with padding:
  const padding = pkcs7(paddingStart)
  const raw = new Uint8Array(paddingStart + padding.length)
  raw.set(padding, paddingStart)

  // Add header:
  raw[0] = headerSize
  raw.set(io.random(headerSize), headerStart)

  // Add payload:
  raw[dataStart - 4] = (dataSize >> 24) & 0xff
  raw[dataStart - 3] = (dataSize >> 16) & 0xff
  raw[dataStart - 2] = (dataSize >> 8) & 0xff
  raw[dataStart - 1] = dataSize & 0xff
  raw.set(data, dataStart)

  // Add footer:
  raw[footerStart - 1] = footerSize
  raw.set(io.random(footerSize), footerStart)

  // Add SHA-256 checksum:
  raw.set(sha256(raw.subarray(0, hashStart)), hashStart)

  // Encrypt to JSON:
  const iv = io.random(16)
  const cipher = new AesCbc(key, iv)
  const ciphertext = cipher.encrypt(raw)
  return {
    encryptionType: 0,
    iv_hex: base16.stringify(iv),
    data_base64: base64.stringify(ciphertext)
  }
}

/**
 * Generates the pkcs7 padding data that should be appended to
 * data of a particular length.
 */
function pkcs7(length: number): Uint8Array {
  const out = new Uint8Array(16 - (length & 0xf))
  for (let i = 0; i < out.length; ++i) out[i] = out.length
  return out
}
