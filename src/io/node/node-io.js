// @flow

import crypto from 'crypto'
import net from 'net'
import tls from 'tls'

import { makeNodeDisklet } from 'disklet'
import fetch from 'node-fetch'
import WebSocket from 'ws'

import { type EdgeIo } from '../../types/types.js'
import { scrypt } from '../../util/crypto/scrypt.js'

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
    disklet: makeNodeDisklet(path),

    // Networking:
    fetch,
    Socket: net.Socket,
    TLSSocket: tls.TLSSocket,
    WebSocket
  }
}
