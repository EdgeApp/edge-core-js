// @flow

import { assert } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { makeFakeContexts } from '../../edge-core-index.js'
import { makeFakeCurrency } from '../../fake-plugins/fakeCurrency.js'
import { fakeExchangePlugin } from '../../fake-plugins/fakeExchange.js'
import { destroyAllContexts } from '../root.js'

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
