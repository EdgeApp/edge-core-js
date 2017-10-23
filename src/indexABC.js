// @flow
import type { AbcContext, AbcContextOptions } from 'airbitz-core-types'
import { fakeUser } from './io/fake/fakeUser.js'
import {
  makeCoreRoot,
  makeFakeCoreRoots,
  startCoreRoot
} from './modules/root.js'

// Sub-module exports:
import * as error from './error.js'
import * as internal from './internal.js'
export { error }
export { internal }

// Polyfill
require('core-js')

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
export function makeContext (opts: AbcContextOptions): AbcContext {
  const coreRoot = makeCoreRoot(opts)
  startCoreRoot(coreRoot)
  return coreRoot.output.contextApi
}

/**
 * Creates one or more fake Airbitz core library instances for testing.
 *
 * The instances all share the same virtual server,
 * but each context receives its own options.
 *
 * The virtual server comes pre-populated with a testing account.
 * The credentials for this account are available in the 'fakeUser' export.
 * Setting the `localFakeUser` context option to `true` will enable PIN
 * and offline password login for that particular context.
 */
export function makeFakeContexts (
  ...opts: Array<AbcContextOptions>
): Array<AbcContext> {
  return makeFakeCoreRoots(...opts).map(coreRoot => {
    startCoreRoot(coreRoot)
    return coreRoot.output.contextApi
  })
}
export { fakeUser }

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
