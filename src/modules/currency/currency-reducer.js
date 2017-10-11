// @flow
import type { AbcCurrencyInfo } from 'airbitz-core-types'
import { buildReducer } from 'redux-keto'
import type { RootAction } from '../actions.js'

export interface CurrencyState {
  infos: Array<AbcCurrencyInfo>;
}

export default buildReducer({
  infos (
    state: Array<AbcCurrencyInfo> = [],
    action: RootAction
  ): Array<AbcCurrencyInfo> {
    return action.type === 'CURRENCY_PLUGINS_LOADED' ? action.payload : state
  }
})
