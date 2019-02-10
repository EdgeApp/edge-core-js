// @flow

import { makeReactNativeDisklet } from 'disklet'
import { NativeModules } from 'react-native'
import { scrypt } from 'react-native-fast-crypto'
import { bridgifyObject } from 'yaob'

import { type ClientIo } from './react-native-types.js'

const randomBytes = NativeModules.RNRandomBytes.randomBytes

export function makeClientIo (): Promise<ClientIo> {
  return new Promise((resolve, reject) => {
    randomBytes(32, (error, base64String) => {
      if (error) return reject(error)

      const out = bridgifyObject({
        console: bridgifyObject({
          info: (...args) => console.info(...args),
          error: (...args) => console.error(...args),
          warn: (...args) => console.warn(...args)
        }),
        disklet: bridgifyObject(makeReactNativeDisklet()),
        entropy: base64String,
        scrypt
      })
      resolve(out)
    })
  })
}
