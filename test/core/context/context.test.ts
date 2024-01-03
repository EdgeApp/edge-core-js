import '../../fake/fake-plugins'

import { expect } from 'chai'
import { describe, it } from 'mocha'
import { base64 } from 'rfc4648'

import { makeFakeEdgeWorld } from '../../../src/index'
import { base58 } from '../../../src/util/encoding'
import { expectRejection } from '../../expect-rejection'
import { fakeUser, fakeUserDump } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('context', function () {
  it('has basic properties', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      appId: 'test'
    })

    expect(context.appId).equals('test')
    expect(context.clientId).match(/[0-9a-zA-Z]+/)
  })

  it('list usernames in local storage', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    expect(context.localUsers).deep.equals([
      {
        keyLoginEnabled: true,
        lastLogin: fakeUser.lastLogin,
        loginId: 'BTnpEn7pabDXbcv7VxnKBDsn4CVSwLRA25J8U84qmg4h',
        pinLoginEnabled: true,
        recovery2Key: 'NVADGXzb5Zc55PYXVVT7GRcXPnY9NZJUjiZK8aQnidc',
        username: 'js test 0',
        voucherId: undefined
      }
    ])
  })

  it('remove loginId from local storage', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const loginId = base58.stringify(base64.parse(fakeUser.loginId))
    expect(await context.localUsers).has.lengthOf(1)
    await context.forgetAccount(loginId)
    expect(await context.localUsers).has.lengthOf(0)
  })

  it('cannot remove logged-in users', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const loginId = base58.stringify(base64.parse(fakeUser.loginId))
    await expectRejection(
      context.forgetAccount(loginId),
      'Error: Cannot remove logged-in user'
    )
  })

  it('dumps fake users', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(
      fakeUser.username,
      fakeUser.pin,
      { now: fakeUser.lastLogin }
    )

    // The dump should not include this new guy's repos:
    await context.createAccount({
      username: 'dummy',
      pin: '1111'
    })

    // Do the dump:
    const dump = await world.dumpFakeUser(account)

    // Get rid of extra `undefined` fields:
    const server = JSON.parse(JSON.stringify(dump.server))

    // The PIN login upgrades the account, so the dump will have extra stuff:
    expect(server.loginAuthBox != null).equals(true)
    expect(server.loginAuth != null).equals(true)
    delete server.loginAuthBox
    delete server.loginAuth

    expect({ ...dump, server }).deep.equals(fakeUserDump)

    // require('fs').writeFileSync('./fake-user.json', JSON.stringify(dump))
  })
})

describe('username', function () {
  it('normalize spaces and capitalization', async function () {
    const world = await makeFakeEdgeWorld([], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    expect(context.fixUsername('  TEST TEST  ')).equals('test test')
  })

  it('reject invalid characters', async function () {
    const world = await makeFakeEdgeWorld([], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    expect(() => context.fixUsername('テスト')).to.throw()
  })
})
