import {IoContext} from '../io.js'
import crypto from 'crypto'
import fetch from 'node-fetch'
import nodeStorage from 'node-localstorage'

export function makeNodeIo (path, opts = {}) {
  const native = {
    console: console,
    fetch: fetch,
    localStorage: new nodeStorage.LocalStorage(path),
    random: bytes => crypto.randomBytes(bytes)
  }

  return new IoContext(native, opts)
}
