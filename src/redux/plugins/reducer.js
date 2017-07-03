import {settableReducer} from '../../util/reducers.js'

const SET = 'airbitz-core-js/plugins/SET'

export function setPlugins (currencyPlugins, exchangePlugins) {
  return { type: SET, payload: { currencyPlugins, exchangePlugins } }
}

const initialState = {
  currencyPlugins: [],
  exchangePlugins: []
}

export default settableReducer(initialState, SET)
