// @flow
import type { FixedIo } from '../io/fixIo.js'
import type { RootState } from '../redux/rootReducer.js'
import type { AbcCorePlugin } from 'airbitz-core-types'
import type { Dispatch } from 'redux'

// The top-level pixie output structure:
export interface RootOutput {}

// Props passed to the root pixie:
export interface RootProps {
  dispatch: Dispatch<any>,
  io: FixedIo,
  onError(e: Error): void,
  output: RootOutput,
  plugins: Array<AbcCorePlugin>,
  state: RootState
}

export const rootPixie = () => (props: RootProps) => {}
