import { settableReducer } from '../../util/redux/reducers.js'

const SET = 'airbitz-core-js/plugins/SET'

export function setPlugins (currencyPlugins, exchangePlugins) {
  return {
    type: SET,
    payload: { currencyPlugins, exchangePlugins, loaded: true }
  }
}

const initialState = {
  currencyPlugins: [],
  exchangePlugins: [],
  loaded: false
}

export default settableReducer(initialState, SET)
