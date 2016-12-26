import {Context} from './context.js'
import {IoContext, makeBrowserIo} from './io/io.js'

export {Context}
export {abcc as ABCConditionCode} from './ABCConditionCode.js'
export {ABCError} from './ABCError.js'
export {normalize as usernameFix} from './userMap.js'

/**
 * Creates a context object.
 */
export function makeContext (opts = {}) {
  const io = new IoContext(makeBrowserIo(), opts)
  return new Context(io, opts)
}

// Another name for the same thing:
export {makeContext as makeABCContext}
