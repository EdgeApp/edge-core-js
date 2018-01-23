// This file exists to hide the React Native dependencies from flow.

// Networking stuff:
let Socket, TLSSocket
try {
  const net = require('react-native-tcp')
  const tls = require('react-native-tcp/tls')
  Socket = net.Socket
  TLSSocket = tls.TLSSocket || tls.Socket
} catch (e) {}
export { Socket, TLSSocket }

// Crypto stuff:
let pbkdf2, scrypt, secp256k1, randomBytes
try {
  const crypto = require('react-native-fast-crypto')
  const RNRandomBytes = require('react-native').NativeModules.RNRandomBytes
  pbkdf2 = crypto.pbkdf2
  scrypt = crypto.scrypt
  secp256k1 = crypto.secp256k1
  randomBytes = RNRandomBytes.randomBytes
} catch (e) {}
export { pbkdf2, scrypt, secp256k1, randomBytes }
