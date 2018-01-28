// @flow

// Polyfills:
import 'core-js'
import 'regenerator-runtime/runtime'

import { isReactNative } from 'detect-bundler'

import type { EdgeContext, EdgeContextOptions } from './edge-core-index.js'
import { isNode, makeNodeIo } from './io/node/node-io.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import {
  makeCoreRoot,
  makeFakeCoreRoots,
  startCoreRoot
} from './modules/root.js'

/**
 * Initializes the Edge core library,
 * defaulting to the browser if no `io` option is provided.
 */
export function makeContext (opts: EdgeContextOptions): EdgeContext {
  const coreRoot = makeCoreRoot(opts)
  startCoreRoot(coreRoot)
  return coreRoot.output.contextApi
}

/**
 * Initializes the Edge core library,
 * automatically selecting the appropriate platform.
 */
export function makeEdgeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  if (isReactNative) return makeReactNativeContext(opts)
  if (isNode) return Promise.resolve(makeNodeContext(opts))
  return Promise.resolve(makeContext(opts))
}

/**
 * Creates one or more fake Edge core library instances for testing.
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
 * Creates an Edge context for use on node.js.
 *
 * @param {{ path?: string }} opts Options for creating the context,
 * including the `path` where data should be written to disk.
 */
export function makeNodeContext (opts: EdgeContextOptions = {}) {
  const { path = './edge' } = opts
  opts.io = makeNodeIo(path)
  return makeContext(opts)
}

/**
 * Creates an Edge context for use with React Native.
 */
export function makeReactNativeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  return makeReactNativeIo().then(io => makeContext({ ...opts, io }))
}
