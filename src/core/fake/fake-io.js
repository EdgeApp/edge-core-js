// @flow

import { makeMemoryDisklet } from 'disklet'

import {
  type EdgeConsole,
  type EdgeFetchFunction,
  type EdgeIo,
  type EdgeRandomFunction
} from '../../types/types.js'
import { scrypt } from '../../util/crypto/scrypt.js'

/**
 * Silences all logging.
 */
export const fakeConsole: EdgeConsole = {
  info() {},
  warn() {},
  error() {}
}

/**
 * Generates deterministic "random" data for unit-testing.
 */
function makeFakeRandom(): EdgeRandomFunction {
  let seed = 0

  return (bytes: number) => {
    const out = new Uint8Array(bytes)

    for (let i = 0; i < bytes; ++i) {
      // Simplest numbers that give a full-period generator with
      // a good mix of high & low values within the first few bytes:
      seed = (5 * seed + 3) & 0xff
      out[i] = seed
    }

    return out
  }
}

const fakeFetch: EdgeFetchFunction = () => {
  return Promise.reject(new Error('Fake network error'))
}

/**
 * Creates a simulated io context object.
 */
export function makeFakeIo(): EdgeIo {
  const out: EdgeIo = {
    // Crypto:
    random: makeFakeRandom(),
    scrypt,

    // Local io:
    console: fakeConsole,
    disklet: makeMemoryDisklet(),

    // Networking:
    fetch: fakeFetch
  }
  return out
}
