// @flow

import { combinePixies, stopUpdates } from 'redux-pixies'
import { update } from 'yaob'

import { type EdgeContext } from '../../types/types.js'
import { type ApiInput } from '../root.js'
import { makeContextApi } from './context-api.js'

export type ContextOutput = {
  api: EdgeContext
}

export const context = combinePixies({
  api: (ai: ApiInput) => () => {
    ai.onOutput(makeContextApi(ai))
    return stopUpdates
  },

  watcher (ai: ApiInput) {
    let lastLocalUsers

    return () => {
      if (lastLocalUsers !== ai.props.state.login.localUsers) {
        lastLocalUsers = ai.props.state.login.localUsers
        if (ai.props.output.context.api) update(ai.props.output.context.api)
      }
    }
  }
})
