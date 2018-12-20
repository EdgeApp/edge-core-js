// @flow

import { makeMemoryDisklet } from 'disklet'

import { type EdgeFakeContextOptions, type EdgeIo } from '../../types/types.js'
import { scrypt } from '../../util/crypto/scrypt.js'
import { FakeWebSocket } from './fake-socket.js'
import { FakeServer } from './fakeServer.js'
import { fakeStashes } from './fakeUser.js'

/**
 * Silences all logging.
 */
export const fakeConsole = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

/**
 * Generates deterministic "random" data for unit-testing.
 */
function makeFakeRandom () {
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

/**
 * Creates an array of io context objects.
 * Each object has its own storage, but all contexts share a server.
 * @param {number} count number of io contexts to create
 */
export function makeFakeIos (count: number): Array<EdgeIo> {
  // The common server used by all contexts:
  const server = new FakeServer()
  const random = makeFakeRandom()

  // Make the io objects:
  const out: Array<EdgeIo> = []
  for (let i = 0; i < count; ++i) {
    out[i] = {
      // Crypto:
      random,
      scrypt,

      // Local io:
      console: fakeConsole,
      disklet: makeMemoryDisklet(),

      // Networking:
      fetch: server.fetch,
      WebSocket: FakeWebSocket
    }
  }

  return out
}

/**
 * Prepares an array of fake IO objects with the provided options.
 */
export function prepareFakeIos (
  opts: Array<EdgeFakeContextOptions>
): Promise<Array<EdgeIo>> {
  return Promise.all(
    makeFakeIos(opts.length).map(async (io, i) => {
      if (opts[i].offline) {
        // Disable network access (but leave the sync server up):
        const oldFetch = io.fetch
        const ioHack: any = io
        ioHack.fetch = (url, opts) =>
          /store/.test(url.toString())
            ? oldFetch(url, opts)
            : Promise.reject(new Error('Network error'))
      }

      // Write the fake users to disk if requested:
      if (opts[i].localFakeUser) {
        await Promise.all(
          Object.keys(fakeStashes).map(name =>
            io.disklet.setText(
              'logins/' + name,
              JSON.stringify(fakeStashes[name])
            )
          )
        )
      }

      return io
    })
  )
}
