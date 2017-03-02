import {Context} from '../../src/context.js'
import {IoContext} from '../../src/io/io.js'
import {FakeServer} from './fakeServer.js'
import {FakeStorage} from './fakeStorage.js'

const fakeConsole = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

/**
 * Generates deterministic "random" data for unit-testing.
 */
function fakeRandom (bytes) {
  const out = []
  let x = 0
  for (let i = 0; i < bytes; ++i) {
    // Simplest numbers that give a full-period generator with
    // a good mix of high & low values within the first few bytes:
    x = ((5 * x) + 3) & 0xff
    out[i] = x
  }
  return out
}

/**
 * Creates an array of context objects.
 * Each object has its own storage, but all contexts share a server.
 * @param {number} count number of contexts to create
 */
export function makeFakeContexts (count, opts = {}) {
  // The common server used by all contexts:
  const server = new FakeServer()

  // Make the context array:
  const out = []
  for (let i = 0; i < count; ++i) {
    const io = new IoContext({
      console: fakeConsole,
      fetch: server.fetch,
      localStorage: new FakeStorage(),
      random: fakeRandom
    })
    out[i] = new Context(io, {
      accountType: opts.accountType
    })
  }

  return out
}
