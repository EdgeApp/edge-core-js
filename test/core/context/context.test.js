// @flow

import '../../fake/fake-plugins.js'

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import { fakeUser, fakeUserDump } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

describe('context', function () {
  it('lists usernames', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext(contextOptions)

    expect(await context.listUsernames()).deep.equals(['js test 0'])
  })

  it('dumps fake users', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // We should not dump this new guy's repos:
    await context.createAccount('dummy', undefined, '1111')

    const dump = await world.dumpFakeUser(account)
    // require('fs').writeFileSync('./fake-user.json', JSON.stringify(dump))
    expect(dump).deep.equals(fakeUserDump)
  })
})
