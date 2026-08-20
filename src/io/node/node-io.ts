import crypto from 'crypto'
import { makeNodeDisklet } from 'disklet'
import fetch from 'node-fetch'
import { resolve } from 'path'

import { EdgeFetchOptions, EdgeIo } from '../../types/types'
import { scrypt } from '../../util/crypto/scrypt'

/**
 * Creates the io resources needed to run the Edge core on node.js.
 *
 * @param {string} path Location where data should be written to disk.
 */
export function makeNodeIo(path: string): EdgeIo {
  const resolved = resolve(path)
  return {
    // Crypto:
    random(bytes: number) {
      return Uint8Array.from(crypto.randomBytes(bytes))
    },
    scrypt,

    // Local io:
    disklet: makeNodeDisklet(resolved),
    path: resolved,

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions) {
      if (opts?.privacy === 'nym') {
        throw new Error('NYM mixFetch is not supported in Node.js')
      }
      return fetch(uri, opts)
    },
    fetchCors: fetch
  }
}
