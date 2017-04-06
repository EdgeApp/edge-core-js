import { Context } from './api/context.js'
import {makeBrowserIo} from './io/browser'
import {makeFakeIos} from './io/fake'
import {makeNodeIo} from './io/node'

/**
 * Initializes the Airbitz core library for use in a browser.
 * @return An Airbitz core library instance.
 */
export function makeBrowserContext (opts = {}) {
  return new Context(makeBrowserIo(opts), opts)
}

/**
 * Creates mock Airbitz contexts for use in unit tests.
 * All the contexts share a fake in-memory server,
 * so accounts created on one context can be loaded from another context.
 * This makes it possible to unit-test various peer-to-peer scenarios.
 * @return An Airbitz core library instance.
 */
export function makeFakeContexts (count, opts = {}) {
  return makeFakeIos(count, opts).map(io => new Context(io, opts))
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

// Secret CLI exports:
import * as internal from './internal.js'
export { internal }

// Deprecated exports:
export { abcc as ABCConditionCode } from './api/ABCConditionCode.js'
export { ABCError } from './api/ABCError.js'
export {Context}
export {fixUsername as usernameFix} from './io/loginStore.js'
export {makeBrowserContext as makeABCContext}
export {makeBrowserContext as makeContext}
