// @flow

import { isReactNative } from 'detect-bundler'

import { makeBrowserIo } from './io/browser/browser-io.js'
import { makeFakeIos, prepareFakeIos } from './io/fake/fake-io.js'
import { isNode, makeNodeIo } from './io/node/node-io.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import { makeFakeWorld } from './modules/fake/fake-world.js'
import { makeContext } from './modules/root.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld
} from './types/types.js'

let fakeWorlds: Array<EdgeFakeWorld> = []

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

/**
 * Creates a fake Edge server for unit testing.
 */
export async function makeFakeEdgeWorld (
  users: Array<EdgeFakeUser> = []
): Promise<EdgeFakeWorld> {
  const [io] = makeFakeIos(1)
  const out = makeFakeWorld(io, users)
  fakeWorlds.push(out)
  return out
}

/**
 * Cleans the fake Edge servers after a unit test.
 */
export function closeFakeEdgeWorlds () {
  Promise.all(fakeWorlds.map(world => world.close())).catch(() => {})
  fakeWorlds = []
}
