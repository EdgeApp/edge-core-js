// @flow

import type { EdgeRawIo } from '../../edge-core-index.js'

export function makeReactNativeIo (): Promise<EdgeRawIo> {
  throw new Error('This function only works on React Native')
}
