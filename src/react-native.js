// @flow

import { makeContext, makeFakeWorld } from './core/core.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld
} from './types/types.js'

export { makeReactNativeIo }
export { closeEdge, makeFakeIo } from './core/core.js'
export * from './types/types.js'

export function makeEdgeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  return makeReactNativeIo().then(io => makeContext(io, opts))
}

export function makeFakeEdgeWorld (
  users: Array<EdgeFakeUser> = []
): Promise<EdgeFakeWorld> {
  return makeReactNativeIo().then(io => makeFakeWorld(io, users))
}
