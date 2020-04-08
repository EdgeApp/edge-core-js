// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

describe('data store API', function () {
  it('stores data', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const storeId = 'localdogecoin'

    // Empty to start:
    expect(await account.dataStore.listStoreIds()).deep.equals([])

    // Set some items:
    await account.dataStore.setItem(storeId, 'username', 'shibe')
    await account.dataStore.setItem(storeId, 'password', 'm00n')

    // The items should be there:
    expect(await account.dataStore.listStoreIds()).deep.equals([storeId])
    expect(await account.dataStore.listItemIds(storeId)).deep.equals([
      'username',
      'password'
    ])
    expect(await account.dataStore.getItem(storeId, 'username')).equals('shibe')
    expect(await account.dataStore.getItem(storeId, 'password')).equals('m00n')

    // Delete an item:
    await account.dataStore.deleteItem(storeId, 'username')
    expect(await account.dataStore.listItemIds(storeId)).deep.equals([
      'password'
    ])

    // Delete the plugin:
    await account.dataStore.deleteStore(storeId)
    expect(await account.dataStore.listStoreIds()).deep.equals([])
  })
})
