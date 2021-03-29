// @flow

import crypto from 'crypto'
import { makeNodeDisklet } from 'disklet'
import fetch from 'node-fetch'

import { fakeErrorReporter } from '../../core/fake/fake-io.js'
import { type EdgeIo, type ErrorReporter } from '../../types/types.js'
import { scrypt } from '../../util/crypto/scrypt.js'

/**
 * Creates the io resources needed to run the Edge core on node.js.
 *
 * @param {string} path Location where data should be written to disk.
 */
export function makeNodeIo(
  path: string,
  errorReporter?: ErrorReporter
): EdgeIo {
  return {
    // Crypto:
    random(bytes: number) {
      return Uint8Array.from(crypto.randomBytes(bytes))
    },
    scrypt,

    // Local io:
    console,
    disklet: makeNodeDisklet(path),
    errorReporter: errorReporter ?? fakeErrorReporter,

    // Networking:
    fetch,
    fetchCors: fetch
  }
}
