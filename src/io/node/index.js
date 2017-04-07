import crypto from 'crypto'
import fetch from 'node-fetch'
import nodeStorage from 'node-localstorage'

function random (bytes) {
  crypto.randomBytes(bytes)
}

export function makeNodeIo (path) {
  return {
    console,
    fetch,
    localStorage: new nodeStorage.LocalStorage(path),
    random
  }
}
