import { makeMemoryDisklet } from 'disklet'

import {
  EdgeFetchFunction,
  EdgeIo,
  EdgeRandomFunction
} from '../../types/types'
import { scrypt } from '../../util/crypto/scrypt'

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
    disklet: makeMemoryDisklet(),

    // Networking:
    fetch: fakeFetch
  }
  return out
}
