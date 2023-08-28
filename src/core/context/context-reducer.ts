import { buildReducer } from 'redux-keto'

import { RootAction } from '../actions'
import { RootState } from '../root-reducer'

interface EdgeServers {
  infoServers: string[]
  syncServers: string[]
}
export interface ContextConfigState {
  readonly edgeServers: EdgeServers
}

const defaultEdgeServers = {
  infoServers: [],
  syncServers: []
}

export const contextConfig = buildReducer<
  ContextConfigState,
  RootAction,
  RootState
>({
  edgeServers(state = defaultEdgeServers, action) {
    if (action.type === 'INIT') {
      const { infoServers, syncServers } = action.payload
      return { infoServers, syncServers }
    }
    return state
  }
})
