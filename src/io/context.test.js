import { makeContext, makeFakeIos } from '../indexABC.js'
import { makeFakeCurrency } from '../test/fakeCurrency.js'
import { fakeExchangePlugin } from '../test/fakeExchange.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

function makeFakeContexts (count, opts) {
  return makeFakeIos(count).map(io => makeContext({ ...opts, io }))
}

describe('context', function () {
  it('returns the currency plugin list', async function () {
    const [context] = makeFakeContexts(1, {
      plugins: [makeFakeCurrency(), fakeExchangePlugin]
    })

    const plugins = await context.getCurrencyPlugins()
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0].currencyInfo.currencyCode, 'TEST')
  })
})
