// @flow

import '../../fake/fake-plugins.js'

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import { expectRejection } from '../../expect-rejection.js'
import { fakeUser, fakeUserDump } from '../../fake/fake-user.js'

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

    const list = await context.listUsernames()
    expect(list).deep.equals(['js test 0'])

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

  it('remove username from local storage', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    expect(await context.listUsernames()).has.lengthOf(1)
    await context.deleteLocalAccount(fakeUser.username)
    expect(await context.listUsernames()).has.lengthOf(0)
  })

  it('cannot remove logged-in users', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await expectRejection(
      context.deleteLocalAccount(fakeUser.username),
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
    await context.createAccount('dummy', undefined, '1111')

    // Do the dump:
    const dump = await world.dumpFakeUser(account)

    // The PIN login upgrades the account, so the dump will have extra stuff:
    expect(dump.server.loginAuthBox != null).equals(true)
    expect(dump.server.loginAuth != null).equals(true)
    dump.server.loginAuthBox = undefined
    dump.server.loginAuth = undefined

    // Get rid of extra `undefined` fields:
    dump.server = JSON.parse(JSON.stringify(dump.server))

    // require('fs').writeFileSync('./fake-user.json', JSON.stringify(dump))
    expect(dump).deep.equals(fakeUserDump)
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
