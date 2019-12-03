// @flow

import { makeLocalBridge } from 'yaob'

import { makeContext, makeFakeWorld } from './core/core.js'
import { makeNodeIo } from './io/node/node-io.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld
} from './types/types.js'

export { makeNodeIo }
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
  const { path = './edge' } = opts
  return makeContext(makeNodeIo(path), {}, opts)
}

export function makeFakeEdgeWorld(
  users: EdgeFakeUser[] = []
): Promise<EdgeFakeWorld> {
  return Promise.resolve(
    makeLocalBridge(makeFakeWorld(makeNodeIo('.'), {}, users), {
      cloneMessage: message => JSON.parse(JSON.stringify(message))
    })
  )
}
