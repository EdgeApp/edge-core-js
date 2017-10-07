// @flow
import { assert } from 'chai'
import { describe, it } from 'mocha'
import { attachPixie, filterPixie } from 'redux-pixies'
import { fakeExchangePlugin } from '../../fake-plugins/fakeExchange.js'
import { makeFakeCoreRoots, makeRootProps } from '../root.js'
import { exchangePlugins } from './loadPlugins.js'

describe('plugins pixie', function () {
  it('adds plugins', async function () {
    const [coreRoot] = makeFakeCoreRoots({ plugins: [fakeExchangePlugin] })

    const output = await new Promise((resolve, reject) =>
      attachPixie(
        coreRoot.redux,
        filterPixie(exchangePlugins, makeRootProps(coreRoot)),
        reject,
        resolve
      )
    )

    assert.equal(output.length, 1)
    assert.equal(output[0].exchangeInfo.exchangeName, 'FakeExchange')
  })
})
