// @flow

import { makeNodeFolder } from 'disklet'

import type { EdgeIo } from '../../edge-core-index.js'
import { scrypt } from '../../util/crypto/scrypt.js'

// Dynamically import platform-specific stuff:
let crypto
let fetch
let net
let tls
let WebSocket
try {
  crypto = require('crypto')
  fetch = require('node-fetch')
  net = require('net')
  tls = require('tls')
  WebSocket = require('ws')
} catch (e) {}

/**
 * Returns true if the runtime environment appears to be node.js.
 */
export const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null

/**
 * Creates the io resources needed to run the Edge core on node.js.
 *
 * @param {string} path Location where data should be written to disk.
 */
export function makeNodeIo (path: string): EdgeIo {
  if (!isNode) {
    throw new Error('This function only works on node.js')
  }

  return {
    // Crypto:
    random (bytes: number) {
      return crypto.randomBytes(bytes)
    },
    scrypt,

    // Local io:
    console,
    folder: makeNodeFolder(path),

    // Networking:
    fetch,
    Socket: net.Socket,
    TLSSocket: tls.TLSSocket,
    WebSocket
  }
}
