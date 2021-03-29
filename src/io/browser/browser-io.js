// @flow

import { makeLocalStorageDisklet } from 'disklet'

import { fakeErrorReporter } from '../../core/fake/fake-io.js'
import {
  type EdgeFetchOptions,
  type EdgeFetchResponse,
  type EdgeIo,
  type ErrorReporter
} from '../../types/types.js'
import { scrypt } from '../../util/crypto/scrypt.js'

/**
 * Extracts the io functions we need from the browser.
 */
export function makeBrowserIo(errorReporter?: ErrorReporter): EdgeIo {
  if (typeof window === 'undefined') {
    throw new Error('No `window` object')
  }
  if (window.crypto == null || window.crypto.getRandomValues == null) {
    throw new Error('No secure random number generator in this browser')
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
    console,
    disklet: makeLocalStorageDisklet(window.localStorage, {
      prefix: 'airbitz'
    }),
    errorReporter: errorReporter ?? fakeErrorReporter,

    // Networking:
    fetch(uri: string, opts?: EdgeFetchOptions): Promise<EdgeFetchResponse> {
      return window.fetch(uri, opts)
    }
  }
}
