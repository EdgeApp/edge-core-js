// @flow
import { makeCurrencyWallet } from './currencyWallets/api.js'
import { makeContext } from './io/context.js'
import { makeFakeIos } from './io/fake'
import type { AbcContext, AbcContextOptions } from 'airbitz-core-types'

// Sub-module exports:
import * as error from './error.js'
import * as internal from './internal.js'
export { error }
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
export { makeContext }

/**
 * Creates one or more fake Airbitz core library instances for testing.
 * The instances all share the same virtual server,
 * but each one receives its own options.
 */
export function makeFakeContexts (
  ...opts: Array<AbcContextOptions>
): Array<AbcContext> {
  return makeFakeIos(opts.length).map((io, i) =>
    makeContext({ ...opts[i], io })
  )
}

/**
 * Older, deprecated version of `makeContext`.
 * It should be named `makeAbcContext`, if anything.
 */
export function makeABCContext (
  apiKey: string,
  appId: string,
  opts: AbcContextOptions
): AbcContext {
  return makeContext({ apiKey, appId, ...opts })
}

/**
 * Creates a new wallet object based on a set of keys. Deprecated.
 */
export { makeCurrencyWallet }
