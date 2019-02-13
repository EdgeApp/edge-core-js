// @flow

import { makeContext } from './core/core.js'
import { makeNodeIo } from './io/node/node-io.js'
import * as error from './types/error.js'
import { type EdgeContext, type EdgeContextOptions } from './types/types.js'
import { hmacSha256 } from './util/crypto/crypto.js'
import { base58, utf8 } from './util/encoding.js'
import { filterObject, mergeDeeply, softCat } from './util/util.js'

export { error, makeNodeIo }
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

// We are exporting some internal goodies for the CLI,
// which makes use of some undocumented core features.
// In the future we hope to minimize / reduce this
export const internal = {
  base58,
  filterObject,
  hmacSha256,
  mergeDeeply,
  softCat,
  utf8
}
