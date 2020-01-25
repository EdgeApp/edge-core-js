// @flow

import { makeMemoryDisklet } from 'disklet'

import { type EdgeConsole, type EdgeIo } from '../../types/types.js'
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
function makeFakeRandom() {
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

function fakeFetch() {
  return Promise.reject(new Error('Fake network error'))
}

/**
 * TODO: WebSocket mock.
 */
class FakeWebSocket {
  constructor(url: string) {
    this.url = url
  }

  +url: string
  close(code?: number, reason?: string): void {}
  send(data: string | ArrayBuffer): void {}

  static CONNECTING: 0
  static OPEN: 1
  static CLOSING: 2
  static CLOSED: 3
}
FakeWebSocket.CONNECTING = 0
FakeWebSocket.OPEN = 1
FakeWebSocket.CLOSING = 2
FakeWebSocket.CLOSED = 3

/**
 * Creates a simulated io context object.
 */
export function makeFakeIo(): EdgeIo {
  const flowHack: any = FakeWebSocket

  const out: EdgeIo = {
    // Crypto:
    random: makeFakeRandom(),
    scrypt,

    // Local io:
    console: fakeConsole,
    disklet: makeMemoryDisklet(),

    // Networking:
    fetch: fakeFetch,
    WebSocket: flowHack
  }
  return out
}
