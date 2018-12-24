// @flow

import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { closeFakeEdgeWorlds, makeFakeEdgeWorld } from '../../../src/index.js'
import { fakeUser, fakeUserDump } from '../../fake/fake-user.js'

afterEach(function () {
  closeFakeEdgeWorlds()
})

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
    await context.createAccount('dummy', void 0, '1111')

    const dump = await world.dumpFakeUser(account)
    // require('fs').writeFileSync('./fake-user.json', JSON.stringify(dump))
    expect(dump).deep.equals(fakeUserDump)
  })
})
