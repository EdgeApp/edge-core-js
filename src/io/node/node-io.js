// @flow

import crypto from 'crypto'

import { makeNodeDisklet } from 'disklet'
import fetch from 'node-fetch'
import WebSocket from 'ws'

import { type EdgeIo } from '../../types/types.js'
import { scrypt } from '../../util/crypto/scrypt.js'

/**
 * Creates the io resources needed to run the Edge core on node.js.
 *
 * @param {string} path Location where data should be written to disk.
 */
export function makeNodeIo (path: string): EdgeIo {
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
    WebSocket
  }
}
