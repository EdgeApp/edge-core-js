// @flow
import type { RootState } from './root-reducer.js'

export function getIo (state: RootState) {
  return state.io
}
