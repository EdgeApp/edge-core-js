import { Context } from './io/context.js'
import { objectAssign } from './util/util.js'

// Secret CLI exports:
import * as internal from './internal.js'
export { internal }

// Ancillary exports:
export * from './error.js'
export { makeBrowserIo } from './io/browser'
export { makeFakeIos } from './io/fake'

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
