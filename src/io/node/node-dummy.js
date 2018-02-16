// @flow

import type { EdgeRawIo } from '../../edge-core-index.js'

export const isNode = false

export function makeNodeIo (path: string): EdgeRawIo {
  throw new Error('This function only works on node.js')
}
