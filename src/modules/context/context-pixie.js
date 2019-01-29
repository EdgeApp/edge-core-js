// @flow

import { type TamePixie, combinePixies, stopUpdates } from 'redux-pixies'
import { close, update } from 'yaob'

import { type EdgeContext } from '../../types/types.js'
import { type ApiInput, type RootProps } from '../root-pixie.js'
import { makeContextApi } from './context-api.js'

export type ContextOutput = {
  api: EdgeContext
}

export const context: TamePixie<RootProps> = combinePixies({
  api (ai: ApiInput) {
    return {
      destroy () {
        close(ai.props.output.context.api)
      },
      update () {
        ai.onOutput(makeContextApi(ai))
        return stopUpdates
      }
    }
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
