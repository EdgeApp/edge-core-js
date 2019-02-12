// @flow

import { makeContext } from './core/core.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import { type EdgeContext, type EdgeContextOptions } from './types/types.js'

export { makeReactNativeIo }
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
  return makeReactNativeIo().then(io => makeContext(io, opts))
}
