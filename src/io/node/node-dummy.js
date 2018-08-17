// @flow

import type { EdgeIo } from '../../edge-core-index.js'

export const isNode = false

export function makeNodeIo (path: string): EdgeIo {
  throw new Error('This function only works on node.js')
}
