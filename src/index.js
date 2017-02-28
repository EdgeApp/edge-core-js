import {Context} from './context.js'
import {IoContext, makeBrowserIo} from './io/io.js'

/**
 * Creates a context object.
 */
export function makeContext (opts = {}) {
  const io = new IoContext(makeBrowserIo(), opts)
  return new Context(io, opts)
}

// Ancillary exports:
export * from './error.js'
export {makeRandomGenerator} from './crypto/crypto.js'

// Deprecated exports:
export {abcc as ABCConditionCode} from './ABCConditionCode.js'
export {ABCError} from './ABCError.js'
export {Context}
export {fixUsername as usernameFix} from './io/loginStore.js'
export {makeContext as makeABCContext}
