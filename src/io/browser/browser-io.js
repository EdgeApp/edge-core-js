// @flow

import { makeLocalStorageFolder } from 'disklet'

import type { EdgeIo } from '../../edge-core-index.js'
import { scrypt } from '../../util/crypto/scrypt.js'
import { fakeConsole } from '../fake/fake-io.js'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo (): EdgeIo {
  if (typeof window === 'undefined') {
    throw new Error('No `window` object')
  }
  if (window.crypto == null || window.crypto.getRandomValues == null) {
    throw new Error('No secure random number generator in this browser')
  }
  if (window.WebSocket == null) {
    throw new Error('No `WebSocket` object')
  }

  return {
    // Crypto:
    random: size => {
      const out = new Uint8Array(size)
      window.crypto.getRandomValues(out)
      return out
    },
    scrypt,

    // Local io:
    console: typeof console !== 'undefined' ? console : fakeConsole,
    folder: makeLocalStorageFolder(window.localStorage, { prefix: 'airbitz' }),

    // Networking:
    fetch: (...rest) => window.fetch(...rest),
    WebSocket: window.WebSocket
  }
}
