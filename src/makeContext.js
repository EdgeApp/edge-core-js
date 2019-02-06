// @flow

import { isReactNative } from 'detect-bundler'

import { prepareFakeIos } from './core/fake/fake-io.js'
import { makeContext } from './core/root.js'
import { makeBrowserIo } from './io/browser/browser-io.js'
import { isNode, makeNodeIo } from './io/node/node-io.js'
import { makeReactNativeIo } from './io/react-native/react-native-dummy.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeContextOptions
} from './types/types.js'

/**
 * Initializes the Edge core library,
 * automatically selecting the appropriate platform.
 */
export function makeEdgeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  if (isReactNative) {
    return makeReactNativeIo().then(io => makeContext(io, opts))
  }
  if (isNode) {
    const { path = './edge' } = opts
    return makeContext(makeNodeIo(path), opts)
  }
  return makeContext(makeBrowserIo(), opts)
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
export async function makeFakeContexts (
  ...opts: Array<EdgeFakeContextOptions>
): Promise<Array<EdgeContext>> {
  return prepareFakeIos(opts).then(ios =>
    Promise.all(ios.map((io, i) => makeContext(io, opts[i])))
  )
}
