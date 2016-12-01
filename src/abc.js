import {Context} from './context.js'

export {Context}
export {abcc as ABCConditionCode} from './ABCConditionCode.js'
export {ABCError} from './ABCError.js'
export {normalize as usernameFix} from './userMap.js'

/**
 * Creates a context object.
 */
export function makeContext (opts) {
  return new Context(opts)
}
