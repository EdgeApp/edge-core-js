// @flow
import { makeLocalStorageFolder } from 'disklet'

import type { AbcIo, AbcRawIo } from '../edge-core-index.js'
import { scrypt } from '../util/crypto/scrypt.js'

/**
 * Checks the properties of an `io` object,
 * upgrading obsolete ones and verifying that we have all necessary ones.
 */
export function fixIo (io: AbcRawIo): AbcIo {
  const out: any = {}

  // Copy native io resources:
  const keys = ['console', 'fetch', 'folder', 'random', 'scrypt']
  for (const key of keys) {
    out[key] = io[key]
  }

  // If there is no native folder, try `localStorage` instead:
  if (out.folder == null && io.localStorage != null) {
    out.folder = makeLocalStorageFolder(io.localStorage, {
      prefix: 'airbitz'
    })
  }

  // If there is no scrypt, use the JS one:
  if (out.scrypt == null) {
    out.scrypt = scrypt
  }

  if (io.secp256k1) {
    out.secp256k1 = io.secp256k1
  }

  if (io.pbkdf2) {
    out.pbkdf2 = io.pbkdf2
  }

  // Verify that we have what we need:
  for (const key of keys) {
    if (out[key] == null) {
      throw new Error(`Could not find "${key}" in the environment`)
    }
  }

  // The network interface (used by plugins):
  if (io.net != null) out.net = io.net
  if (io.Socket != null) out.Socket = io.Socket
  if (io.TLSSocket != null) out.TLSSocket = io.TLSSocket
  if (io.WebSocket != null) out.WebSocket = io.WebSocket

  return out
}
