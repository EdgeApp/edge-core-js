import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index'
import { airbitzFiles, fakeUser } from '../../fake/fake-user'

const quiet = { onLog() {} }

describe('airbitz stashes', function () {
  it('can log into legacy airbitz files', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      airbitzSupport: true,
      apiKey: '',
      appId: '',
      cleanDevice: true,
      extraFiles: airbitzFiles
    })
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })
})
