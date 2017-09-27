// @flow
import { exchangePlugins } from './loadPlugins.js'
import { makeFakeProps } from '../../test/fakeProps.js'
import { fakeExchangePlugin } from '../../test/fakeExchange.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'
import { startPixie } from 'redux-pixies'

describe('plugins pixie', function () {
  it('adds plugins', async function () {
    const fakeProps = makeFakeProps()
    fakeProps.plugins = [fakeExchangePlugin]

    const output = await new Promise((resolve, reject) =>
      startPixie(exchangePlugins, reject, resolve).update(fakeProps)
    )

    assert.equal(output.length, 1)
    assert.equal(output[0].exchangeInfo.exchangeName, 'FakeExchange')
  })
})
