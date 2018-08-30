// @flow

import { combinePixies, stopUpdates } from 'redux-pixies'

import type { EdgeContext } from '../../edge-core-index.js'
import type { ApiInput } from '../root.js'
import { makeContextApi } from './context-api.js'

export type ContextOutput = {
  api: EdgeContext
}

export default combinePixies({
  api: (ai: ApiInput) => () => {
    ai.onOutput(makeContextApi(ai))
    return stopUpdates
  }
})
