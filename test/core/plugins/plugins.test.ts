import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index'
import { capturedNativeIo } from '../../fake/fake-plugins'
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

  it('passes nativeIo to in-process plugins', async function () {
    const nativeIo = { monero: { ping: () => 'pong' } }
    const world = await makeFakeEdgeWorld([fakeUser], { ...quiet, nativeIo })
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { 'native-io-probe': true }
    })
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(capturedNativeIo).to.equal(nativeIo)
    expect(
      (capturedNativeIo?.monero as { ping: () => string }).ping()
    ).to.equal('pong')
  })
})
