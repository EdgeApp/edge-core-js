import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index'
import { expectRejection } from '../../expect-rejection'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('plugins system', function () {
  it('adds plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'broken-exchange': true,
        'fake-exchange': true,
        'missing-plugin': false,
        fakecoin: true,
        fakeswap: { apiKey: '' }
      }
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(Object.keys(account.currencyConfig)).deep.equals(['fakecoin'])
    expect(Object.keys(account.swapConfig)).deep.equals(['fakeswap'])
  })

  it('cannot log in with broken plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'broken-plugin': true,
        'fake-exchange': true,
        'missing-plugin': true,
        fakeswap: false
      }
    })
    return await expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: The following plugins are missing or failed to load: broken-plugin, missing-plugin'
    )
  })
})
