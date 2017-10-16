import { assert } from 'chai'
import { afterEach, describe, it } from 'mocha'
import { makeFakeCurrency } from '../../fake-plugins/fakeCurrency.js'
import { fakeExchangePlugin } from '../../fake-plugins/fakeExchange.js'
import { makeFakeContexts } from '../../indexABC.js'
import { destroyAllCores } from '../root.js'

// Silence console.info:
console.info = () => {}

afterEach(function () {
  destroyAllCores()
})

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
