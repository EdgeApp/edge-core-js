// @flow

import { makeContext } from './core/core.js'
import { makeNodeIo } from './io/node/node-io.js'
import { type EdgeContext, type EdgeContextOptions } from './types/types.js'

export { makeNodeIo }
export {
  destroyAllContexts,
  fakeUser,
  fakeUser1,
  makeFakeContexts,
  makeFakeIos
} from './core/core.js'
export * from './types/types.js'

export function makeEdgeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const { path = './edge' } = opts
  return makeContext(makeNodeIo(path), opts)
}
