// @flow
import { assert } from 'chai'
import { describe, it } from 'mocha'
import { startPixie } from 'redux-pixies'
import { fakeExchangePlugin } from '../../fake-plugins/fakeExchange.js'
import { makeFakeProps } from '../fakeProps.js'
import { exchangePlugins } from './loadPlugins.js'

describe('plugins pixie', function () {
  it('adds plugins', async function () {
    const [fakeProps] = makeFakeProps({})
    fakeProps.plugins = [fakeExchangePlugin]

    const output = await new Promise((resolve, reject) =>
      startPixie(exchangePlugins, reject, resolve).update(fakeProps)
    )

    assert.equal(output.length, 1)
    assert.equal(output[0].exchangeInfo.exchangeName, 'FakeExchange')
  })
})
