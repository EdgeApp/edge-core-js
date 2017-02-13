import {Context} from './context.js'
import {makeBrowserIo} from './io/browser'
import {makeNodeIo} from './io/node'

/**
 * Initializes the Airbitz core library for use in a browser.
 * @return An Airbitz core library instance.
 */
export function makeBrowserContext (opts = {}) {
  return new Context(makeBrowserIo(opts), opts)
}

/**
 * Initializes the Airbitz core library for use on node.js.
 * @param workDir The path to a directory where the core can save information.
 * @return An Airbitz core library instance.
 */
export function makeNodeContext (path, opts = {}) {
  return new Context(makeNodeIo(path, opts), opts)
}

// Ancillary exports:
export * from './error.js'
export {makeRandomGenerator} from './crypto/crypto.js'

// Deprecated exports:
export {abcc as ABCConditionCode} from './ABCConditionCode.js'
export {ABCError} from './ABCError.js'
export {Context}
export {fixUsername as usernameFix} from './io/loginStore.js'
export {makeBrowserContext as makeABCContext}
export {makeBrowserContext as makeContext}
