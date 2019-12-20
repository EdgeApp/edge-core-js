// @flow

import { assert } from 'chai'
import { describe, it } from 'mocha'

import { type RootAction } from '../../../src/core/actions.js'
import { type ExchangePair } from '../../../src/core/exchange/exchange-reducer.js'
import { getExchangeRate } from '../../../src/core/exchange/exchange-selectors.js'
import { reducer } from '../../../src/core/root-reducer.js'
import { makeFakeEdgeWorld } from '../../../src/index.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

// A hypothetical collection of currency pairs.
// The fiat currencies would start with `iso:` in a real exchange-rate cache.
function makePairs(): ExchangePair[] {
  const now = Date.now() / 1000

  return [
    {
      fromCurrency: 'BTC',
      rate: 2500,
      source: 'simpleSource',
      toCurrency: 'USD',
      timestamp: now - 10
    },
    {
      fromCurrency: 'BTC',
      rate: 2600,
      source: 'complexSource',
      toCurrency: 'EUR',
      timestamp: now - 30
    },
    {
      fromCurrency: 'BTC',
      rate: 260000,
      source: 'complexSource',
      toCurrency: 'JPY',
      timestamp: now - 30
    },
    {
      fromCurrency: 'USD',
      rate: 1.1,
      source: 'complexSource',
      toCurrency: 'EUR',
      timestamp: now - 30
    },
    {
      fromCurrency: 'EUR',
      rate: 0.85,
      source: 'extraSource',
      toCurrency: 'USD',
      timestamp: now - 10
    }
  ]
}

// The expected uniqueness cache for the exchange rates:
const ids = {
  'simpleSource,BTC,USD': 0,
  'complexSource,BTC,EUR': 1,
  'complexSource,BTC,JPY': 2,
  'complexSource,USD,EUR': 3,
  'extraSource,EUR,USD': 4
}

// The expected currency lookup table for the exchange rates:
const routes = {
  BTC: { EUR: [1], USD: [0], JPY: [2] },
  EUR: { BTC: [1], USD: [3, 4] },
  USD: { BTC: [0], EUR: [3, 4] },
  JPY: { BTC: [2] }
}

function addPairs(pairs: ExchangePair[]): RootAction {
  return { type: 'EXCHANGE_PAIRS_FETCHED', payload: pairs }
}

describe('exchange cache reducer', function() {
  it('add currency pairs', function() {
    const pairs = makePairs()

    // Add the first currency pair:
    let state = reducer(undefined, addPairs(pairs.slice(0, 1)))
    assert.deepEqual(state.exchangeCache.rates.pairs, pairs.slice(0, 1))

    // Add the rest:
    state = reducer(state, addPairs(pairs.slice(1)))
    assert.deepEqual(state.exchangeCache.rates.pairs, pairs)
    assert.deepEqual(state.exchangeCache.rates.ids, ids)
    assert.deepEqual(state.exchangeCache.rates.routes, routes)
  })

  it('preserve ordering', function() {
    const pairs = makePairs()

    // Add a middle currency , with adjustments:
    const easyPairs = [{ ...pairs[1], rate: 2400 }]
    let state = reducer(undefined, addPairs(easyPairs))
    assert.deepEqual(state.exchangeCache.rates.pairs, easyPairs)

    // Add everything:
    const expected = [...pairs]
    expected[0] = pairs[1]
    expected[1] = pairs[0]
    state = reducer(state, addPairs(pairs))
    assert.deepEqual(state.exchangeCache.rates.pairs, expected)
  })

  it('find the shortest route', function() {
    const pairs = makePairs()
    const state = reducer(undefined, addPairs(pairs))

    assert.equal(
      getExchangeRate(state, 'BTC', 'BTC', () => 1),
      1
    )
    assert.equal(
      getExchangeRate(state, 'BTC', 'USD', () => 1),
      2500
    )
    assert.equal(
      getExchangeRate(state, 'JPY', 'USD', () => 1),
      (1 / 260000) * 2500 // 0.0096
    )
  })

  it('find a route using the preferred exchange', function() {
    const pairs = makePairs()
    const state = reducer(undefined, addPairs(pairs))

    assert.equal(
      getExchangeRate(state, 'JPY', 'USD', source =>
        source === 'complexSource' ? 1 : 10
      ),
      ((1 / 260000) * 2600) / 1.1 // 0.0091
    )
  })

  it('find the freshest route', function() {
    const pairs = makePairs()
    const state = reducer(undefined, addPairs(pairs))

    assert.equal(
      getExchangeRate(state, 'BTC', 'EUR', (source, age) => age),
      2500 / 0.85 // 2941
    )
  })

  it('missing routes return zero', function() {
    const pairs = makePairs()
    const state = reducer(undefined, addPairs(pairs))

    assert.equal(
      getExchangeRate(state, 'NONE', 'EUR', () => 1),
      0
    )
  })
})

describe('exchange pixie', function() {
  it('fetches exchange rates', async function() {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { 'broken-exchange': true, 'fake-exchange': true }
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const rate = await account.exchangeCache.convertCurrency(
      'BTC',
      'iso:EUR',
      1
    )
    return assert(rate > 2274 && rate < 2277)
  })
})
