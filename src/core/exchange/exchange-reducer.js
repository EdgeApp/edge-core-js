// @flow

import { type Reducer, combineReducers } from 'redux'

import { type RootAction } from '../actions.js'

export type ExchangePair = {
  fromCurrency: string,
  toCurrency: string,
  rate: number,
  source: string,
  timestamp: number
}

export type ExchangeRoutes = {
  [from: string]: { [to: string]: Array<number> }
}

export type ExchangeRatesState = {
  ids: { [id: string]: number },
  pairs: Array<ExchangePair>,
  routes: ExchangeRoutes
}

export type ExchangeState = {
  rates: ExchangeRatesState
}

function addRoute (
  routes: ExchangeRoutes,
  from: string,
  to: string,
  pair: number
) {
  if (!routes[from]) routes[from] = {}
  if (!routes[from][to]) routes[from][to] = []
  routes[from][to].push(pair)
}

/**
 * Currency rates reducer.
 * The raw state is just a list of currency pairs, each having a
 * `fromCurrency`, `toCurrency`, `rate`, `source`, and `timestamp` field.
 *
 * Based on this raw state, we also derive a map of unique id's.
 * This is used to remove duplicates when we add new pairs to the state.
 * If a new pair has the same identity as an existing pair,
 * we use the mapped index to stomp over the old pair.
 *
 * Finally, we store a routing table, which is is just the pairs list
 * indexed by currency. The routing table has twice as many entries
 * as the pair list, since each pair works both ways.
 */
function rates (
  state: ExchangeRatesState = { ids: {}, pairs: [], routes: {} },
  action: RootAction
): ExchangeRatesState {
  if (action.type === 'EXCHANGE_PAIRS_FETCHED') {
    let ids = state.ids
    const pairs = [...state.pairs]

    // Update the id map and pairs array:
    for (const pair of action.payload) {
      const id = `${pair.source},${pair.fromCurrency},${pair.toCurrency}`

      // Have we ever seen this one before?
      const i = ids[id]
      if (i == null) {
        // Copy-on-write ids list:
        if (ids === state.ids) ids = { ...state.ids }
        ids[id] = pairs.length
        pairs.push(pair)
      } else {
        pairs[i] = pair
      }
    }

    // Populate the routes table:
    let routes = state.routes
    if (pairs.length !== state.pairs.length) {
      routes = {}
      for (let i = 0; i < pairs.length; ++i) {
        addRoute(routes, pairs[i].fromCurrency, pairs[i].toCurrency, i)
        addRoute(routes, pairs[i].toCurrency, pairs[i].fromCurrency, i)
      }
    }

    return { ids, pairs, routes }
  }

  return state
}

export const exchangeCache: Reducer<
  ExchangeState,
  RootAction
> = combineReducers({
  rates
})
