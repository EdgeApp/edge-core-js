import { makeFakeContexts } from '../indexABC.js'
import { makeFakeCurrency } from '../test/fakeCurrency.js'
import { fakeExchangePlugin } from '../test/fakeExchange.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

describe('context', function () {
  it('returns the currency plugin list', async function () {
    const [context] = makeFakeContexts({
      plugins: [makeFakeCurrency(), fakeExchangePlugin]
    })

    const plugins = await context.getCurrencyPlugins()
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0].currencyInfo.currencyCode, 'TEST')
  })
})
