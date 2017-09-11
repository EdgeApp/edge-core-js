import { makeFakeCurrency } from '../../test/fakeCurrency.js'
import { fakeExchangePlugin } from '../../test/fakeExchange.js'
import { makeStore } from '../index.js'
import { setupPlugins } from './actions.js'
import { getCurrencyMultiplier, getExchangePlugins } from './selectors.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

describe('plugins reducer', function () {
  it('add exchange plugin', function () {
    const store = makeStore()

    const fakeIo = {}
    return store
      .dispatch(setupPlugins(fakeIo, [fakeExchangePlugin]))
      .then(() => {
        const plugins = getExchangePlugins(store.getState())
        assert.equal(plugins.length, 1)
        assert.equal(plugins[0].exchangeInfo.exchangeName, 'FakeExchange')
        return null
      })
  })

  it('reject invalid plugin', function () {
    const store = makeStore()

    const fakeIo = {}
    const fakePlugin = {
      pluginType: 'fake'
    }
    assert.throws(() => store.dispatch(setupPlugins(fakeIo, [fakePlugin])))
  })

  it('find currency multiplier', function () {
    const store = makeStore()
    const plugin = makeFakeCurrency()

    const fakeIo = {}
    return store.dispatch(setupPlugins(fakeIo, [plugin])).then(() => {
      const state = store.getState()
      assert.equal(getCurrencyMultiplier(state, 'SMALL'), 10)
      assert.equal(getCurrencyMultiplier(state, 'TEST'), 100)
      assert.equal(getCurrencyMultiplier(state, 'TOKEN'), 1000)
      assert.equal(getCurrencyMultiplier(state, '-error-'), 1)
      return null
    })
  })
})
