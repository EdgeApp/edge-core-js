// @flow

import { isReactNative } from 'detect-bundler'
import { makeReactNativeFolder } from 'disklet'
import { base64 } from 'rfc4648'

import type { EdgeRawIo } from '../../edge-core-index.js'
import { HmacDRBG, hashjs } from '../../util/crypto/external.js'
import {
  Socket,
  TLSSocket,
  pbkdf2,
  randomBytes,
  scrypt,
  secp256k1
} from './native-libs.js'

/**
 * Wraps the native `randomBytes` function in a `Promise`.
 */
function getRandom (length) {
  return new Promise((resolve, reject) => {
    randomBytes(length, function (err, base64String) {
      if (err) {
        reject(err)
      } else {
        resolve(base64.parse(base64String.trim()))
      }
    })
  })
}

/**
 * Creates a pseudo-random number generator based on the provided entropy.
 * This can be used to turn an async random number generator into
 * a synchronous one.
 */
function makeRandomGenerator (
  entropy: Uint8Array
): (bytes: number) => Uint8Array {
  const rng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: entropy
  })

  return bytes => rng.generate(bytes)
}

/**
 * Gathers the IO resources needed by the Edge core library.
 */
export function makeReactNativeIo (): Promise<EdgeRawIo> {
  if (!isReactNative) {
    throw new Error('This function only works on React Native')
  }
  if (typeof Socket !== 'function' || typeof randomBytes !== 'function') {
    throw new Error(
      'Please install & link the following libraries: react-native-fast-crypto react-native-fs react-native-randombytes react-native-tcp'
    )
  }

  return getRandom(32).then(entropy => {
    const io: EdgeRawIo = {
      console: {
        info: console.log,
        warn: console.warn,
        error: console.warn
      },
      fetch: (...rest) => window.fetch(...rest),
      folder: makeReactNativeFolder(),
      random: makeRandomGenerator(entropy),
      Socket,
      TLSSocket,
      pbkdf2,
      scrypt,
      secp256k1
    }
    return io
  })
}
