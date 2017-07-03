/* global describe, it */
import { fakeExchangePlugin } from '../../test/fakeExchange.js'
import { makeStore } from '../index.js'
import { setupPlugins } from './actions.js'
import { getExchangePlugins } from './selectors.js'
import assert from 'assert'

describe('plugins reducer', function () {
  it('add exchange plugin', function () {
    const store = makeStore()

    const fakeIo = {}
    store.dispatch(setupPlugins(fakeIo, [fakeExchangePlugin])).then(() => {
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
})
