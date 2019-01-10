// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import { expectRejection } from '../../expect-rejection.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

describe('plugins system', function () {
  it('adds plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'broken-exchange': true,
        'fake-exchange': true,
        'missing-plugin': false,
        faast: false,
        fakecoin: true,
        shapeshift: { apiKey: '' }
      }
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(Object.keys(account.currencyConfig)).deep.equals(['fakecoin'])
    expect(Object.keys(account.swapConfig)).deep.equals(['shapeshift'])
  })

  it('cannot log in with broken plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'broken-plugin': true,
        'fake-exchange': true,
        'missing-plugin': true,
        shapeshift: false
      }
    })
    return expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: The following plugins are missing or failed to load: broken-plugin, missing-plugin'
    )
  })
})
