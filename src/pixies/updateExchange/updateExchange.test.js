// @flow
import { makeCoreRoot } from '../../coreRoot.js'
import { makeFakeIos } from '../../indexABC.js'
import { getExchangeRate } from '../../redux/selectors.js'
import {
  brokenExchangePlugin,
  fakeExchangePlugin
} from '../../test/fakeExchange.js'
import { awaitState } from '../../util/redux/reaction.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

describe('update exchange cache pixie', function () {
  it('fetches exchange rates', async function () {
    const coreRoot = makeCoreRoot({
      io: makeFakeIos(1)[0],
      plugins: [brokenExchangePlugin, fakeExchangePlugin]
    })

    await awaitState(
      coreRoot.redux,
      state => state.exchangeCache.rates.pairs.length > 0
    )

    const state = coreRoot.redux.getState()
    const rate = getExchangeRate(state, 'BTC', 'iso:EUR', pair => 1)
    return assert(rate > 2274 && rate < 2277)
  })
})
