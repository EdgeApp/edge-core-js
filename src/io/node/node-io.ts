import crypto from 'crypto'
import { makeNodeDisklet } from 'disklet'
import fetch from 'node-fetch'

import { EdgeInternalIo } from '../../core/db/db-driver'
import { EdgeFetchOptions } from '../../types/types'
import { scrypt } from '../../util/crypto/scrypt'
import { makeNodeSqlDriverFactory } from './node-sql-driver'

/**
 * Creates the io resources needed to run the Edge core on node.js.
 *
 * @param {string} path Location where data should be written to disk.
 */
export function makeNodeIo(path: string): EdgeInternalIo {
  return {
    // Crypto:
    random(bytes: number) {
      return Uint8Array.from(crypto.randomBytes(bytes))
    },
    scrypt,

    // Local io:
    disklet: makeNodeDisklet(path),

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions) {
      if (opts?.privacy === 'nym') {
        throw new Error('NYM mixFetch is not supported in Node.js')
      }
      return fetch(uri, opts)
    },
    fetchCors: fetch,

    // SQL, which is internal to the core and not part of `EdgeIo`:
    ...makeNodeSqlDriverFactory(path)
  }
}
