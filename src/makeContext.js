// @flow
import type { EdgeContext, EdgeContextOptions } from './edge-core-index.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import {
  makeCoreRoot,
  makeFakeCoreRoots,
  startCoreRoot
} from './modules/root.js'

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
export function makeContext (opts: EdgeContextOptions): EdgeContext {
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
  ...opts: Array<EdgeContextOptions>
): Array<EdgeContext> {
  return makeFakeCoreRoots(...opts).map(coreRoot => {
    startCoreRoot(coreRoot)
    return coreRoot.output.contextApi
  })
}

/**
 * Creates an Edge context for use with React Native.
 */
export function makeReactNativeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  return makeReactNativeIo().then(io => makeContext({ ...opts, io }))
}

/**
 * Older, deprecated version of `makeContext`.
 * It should be named `makeEdgeContext`, if anything.
 */
export function makeABCContext (
  apiKey: string,
  appId: string,
  opts: EdgeContextOptions
): EdgeContext {
  return makeContext({ apiKey, appId, ...opts })
}
