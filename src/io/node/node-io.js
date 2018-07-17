// @flow

import { makeNodeFolder } from 'disklet'

import type { EdgeRawIo } from '../../edge-core-index.js'

// Dynamically import platform-specific stuff:
let crypto
let fetch
let WebSocket
try {
  crypto = require('crypto')
  fetch = require('node-fetch')
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
export function makeNodeIo (path: string): EdgeRawIo {
  if (!isNode) {
    throw new Error('This function only works on node.js')
  }

  return {
    console,
    fetch,
    folder: makeNodeFolder(path),
    random (bytes: number) {
      return crypto.randomBytes(bytes)
    },
    WebSocket
  }
}
