// @flow

import { isReactNative } from 'detect-bundler'

import { makeBrowserIo } from './io/browser/browser-io.js'
import { makeFakeIos } from './io/fake/fake-io.js'
import { isNode, makeNodeIo } from './io/node/node-io.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import { makeFakeWorld } from './modules/fake/fake-world.js'
import { makeContext } from './modules/root.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
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
