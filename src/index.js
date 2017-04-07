import { Context } from './api/context.js'
import {makeBrowserIo} from './io/browser'
import {makeFakeIos} from './io/fake'
import {makeNodeIo} from './io/node'
import { objectAssign } from './util/util.js'

/**
 * Initializes the Airbitz core library.
 *
 * @param opts A object with the following options:
 * - apiKey: Auth server API key
 * - appId: The global identifier for this application
 * - authServer: Alternative auth server to use (optional).
 * - io: Platform-specific IO resources (optional).
 *       Defaults to browser IO if not provided.
 * @return An Airbitz core library instance.
 */
export function makeContext (opts) {
  return new Context(opts)
}

/**
 * Same thing as `makeContext`, but corresponding to the documentation.
 */
export function makeABCContext (apiKey, appId, opts) {
  return makeContext(objectAssign({ apiKey, appId }, opts))
}

/**
 * Initializes the Airbitz core library for use in a browser.
 * @return An Airbitz core library instance.
 */
export function makeBrowserContext (opts) {
  const io = makeBrowserIo()
  return makeContext(objectAssign({ io }, opts))
}

/**
 * Creates mock Airbitz contexts for use in unit tests.
 * All the contexts share a fake in-memory server,
 * so accounts created on one context can be loaded from another context.
 * This makes it possible to unit-test various peer-to-peer scenarios.
 * @return An Airbitz core library instance.
 */
export function makeFakeContexts (count, opts = {}) {
  return makeFakeIos(count).map(
    io => makeContext(objectAssign({ io }, opts))
  )
}

/**
 * Initializes the Airbitz core library for use on node.js.
 * @param workDir The path to a directory where the core can save information.
 * @return An Airbitz core library instance.
 */
export function makeNodeContext (path, opts = {}) {
  const io = makeNodeIo(path)
  return makeContext(objectAssign({ io }, opts))
}

// Ancillary exports:
export * from './error.js'
export { makeBrowserIo } from './io/browser'
export { makeFakeIos } from './io/fake'
export {makeRandomGenerator} from './crypto/crypto.js'

// Secret CLI exports:
import * as internal from './internal.js'
export { internal }

// Deprecated exports:
export { abcc as ABCConditionCode } from './api/ABCConditionCode.js'
export { ABCError } from './api/ABCError.js'
export {Context}
export {fixUsername as usernameFix} from './io/loginStore.js'
