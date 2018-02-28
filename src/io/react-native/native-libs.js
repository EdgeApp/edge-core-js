// This file exists to hide the React Native dependencies from flow.

import { Platform } from 'react-native'

// Networking stuff:
let Socket, TLSSocket
try {
  const net = require('react-native-tcp')
  const tls = require('react-native-tcp/tls')
  Socket = net.Socket
  if (Platform.OS !== 'android') {
    TLSSocket = tls.TLSSocket || tls.Socket
  }
} catch (e) {}
export { Socket, TLSSocket }

// Random numbers:
let randomBytes
try {
  const nativeModules = require('react-native').NativeModules
  randomBytes = nativeModules.RNRandomBytes.randomBytes
} catch (e) {}
export { randomBytes }

// Crypto stuff:
let pbkdf2, scrypt, secp256k1
try {
  let crypto = require('react-native-fast-crypto')
  // The React Native bundler seems to have trouble with default exports:
  if (crypto.default && !crypto.scrypt) crypto = crypto.default

  pbkdf2 = crypto.pbkdf2
  scrypt = crypto.scrypt
  secp256k1 = crypto.secp256k1
} catch (e) {}
export { pbkdf2, scrypt, secp256k1 }
