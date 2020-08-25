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
  it('list usernames in local storage', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    const list = await context.listUsernames()
    expect(list).deep.equals(['js test 0'])

    expect(context.localUsers).deep.equals([
      {
        pinLoginEnabled: true,
        recovery2Key: 'NVADGXzb5Zc55PYXVVT7GRcXPnY9NZJUjiZK8aQnidc',
        username: 'js test 0'
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
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // We should not dump this new guy's repos:
    await context.createAccount('dummy', undefined, '1111')

    const dump = await world.dumpFakeUser(account)
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
    const world = await makeFakeEdgeWorld()
    const context = await world.makeEdgeContext(contextOptions)

    expect(() => context.fixUsername('テスト')).to.throw()
  })
})
