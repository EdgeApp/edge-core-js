import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeLogEvent, makeFakeEdgeWorld } from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('plugins system', function () {
  it('adds plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'missing-plugin': false,
        fakecoin: true,
        fakeswap: { apiKey: '' }
      }
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(Object.keys(account.currencyConfig)).deep.equals(['fakecoin'])
    expect(Object.keys(account.swapConfig)).deep.equals(['fakeswap'])
  })

  it('logs in with broken plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'broken-plugin': true,
        'missing-plugin': true,
        fakecoin: true,
        fakeswap: false
      }
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // The working plugin is available, and the broken ones are simply absent:
    expect(Object.keys(account.currencyConfig)).deep.equals(['fakecoin'])
    expect(Object.keys(account.swapConfig)).deep.equals([])
  })

  it('reports a missing plugin, and a broken one only where it failed', async function () {
    const logs: EdgeLogEvent[] = []
    const world = await makeFakeEdgeWorld([fakeUser], {
      onLog(event) {
        logs.push(event)
      }
    })
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: {
        'broken-plugin': true,
        'missing-plugin': true,
        fakecoin: true
      }
    })
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // The factory error is logged once, under the plugin's own source:
    const brokenErrors = logs.filter(
      event =>
        event.source === 'broken-plugin' &&
        event.message.includes('Expect to fail')
    )
    expect(brokenErrors).has.length(1)

    // Only the id that was never provided is reported as not installed:
    const notInstalled = logs
      .filter(event => event.message.includes('not installed'))
      .map(event => event.message)
    expect(notInstalled.length).is.greaterThan(0)
    for (const message of notInstalled) {
      expect(message).includes('missing-plugin')
      expect(message).not.includes('broken-plugin')
    }
  })
})
