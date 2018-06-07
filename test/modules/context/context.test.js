// @flow

import { assert } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { makeFakeContexts } from '../../../src/edge-core-index.js'
import { destroyAllContexts } from '../../../src/modules/root.js'
import { makeFakeCurrency } from '../../fake-plugins/fake-currency.js'
import { fakeExchangePlugin } from '../../fake-plugins/fake-exchange.js'

// Silence console.info:
const consoleHack: any = console // Flow thinks console is read-only
consoleHack.info = () => {}

afterEach(function () {
  destroyAllContexts()
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
