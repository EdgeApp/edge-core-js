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
    expect(await account.pluginData.listPluginIds()).deep.equals([])

    // Set some items:
    await account.pluginData.setItem(pluginId, 'username', 'shibe')
    await account.pluginData.setItem(pluginId, 'password', 'm00n')

    // The items should be there:
    expect(await account.pluginData.listPluginIds()).deep.equals([pluginId])
    expect(await account.pluginData.listItemIds(pluginId)).deep.equals([
      'username',
      'password'
    ])
    expect(await account.pluginData.getItem(pluginId, 'username')).equals(
      'shibe'
    )
    expect(await account.pluginData.getItem(pluginId, 'password')).equals(
      'm00n'
    )

    // Delete an item:
    await account.pluginData.deleteItem(pluginId, 'username')
    expect(await account.pluginData.listItemIds(pluginId)).deep.equals([
      'password'
    ])

    // Delete the plugin:
    await account.pluginData.deletePlugin(pluginId)
    expect(await account.pluginData.listPluginIds()).deep.equals([])
  })
})
