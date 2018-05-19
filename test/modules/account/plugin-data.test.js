// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import type { EdgeAccount } from '../../../src/edge-core-index.js'
import { fakeUser, makeFakeContexts } from '../../../src/edge-core-index.js'

const contextOptions = {
  localFakeUser: true
}

describe('plugin data API', function () {
  it('stores data', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account: EdgeAccount = await context.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )

    const pluginId = 'localdogecoin'

    // Empty to start:
    expect(await account.pluginData.listPluginIds()).to.deep.equal([])

    // Set some items:
    await account.pluginData.setItem(pluginId, 'username', 'shibe')
    await account.pluginData.setItem(pluginId, 'password', 'm00n')

    // The items should be there:
    expect(await account.pluginData.listPluginIds()).to.deep.equal([pluginId])
    expect(await account.pluginData.listItemIds(pluginId)).to.deep.equal([
      'username',
      'password'
    ])
    expect(await account.pluginData.getItem(pluginId, 'username')).to.equal(
      'shibe'
    )
    expect(await account.pluginData.getItem(pluginId, 'password')).to.equal(
      'm00n'
    )

    // Delete an item:
    await account.pluginData.deleteItem(pluginId, 'username')
    expect(await account.pluginData.listItemIds(pluginId)).to.deep.equal([
      'password'
    ])

    // Delete the plugin:
    await account.pluginData.deletePlugin(pluginId)
    expect(await account.pluginData.listPluginIds()).to.deep.equal([])
  })
})
