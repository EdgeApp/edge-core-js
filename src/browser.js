// @flow

import { makeContext, makeFakeWorld } from './core/core.js'
import { makeBrowserIo } from './io/browser/browser-io.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld
} from './types/types.js'

export { makeBrowserIo }
export {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins,
  makeFakeIo
} from './core/core.js'
export * from './types/types.js'

export function makeEdgeContext(
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  return makeContext(makeBrowserIo(), {}, opts)
}

export function makeFakeEdgeWorld(
  users: EdgeFakeUser[] = []
): Promise<EdgeFakeWorld> {
  return Promise.resolve(makeFakeWorld(makeBrowserIo(), {}, users))
}
