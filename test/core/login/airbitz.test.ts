import { expect } from 'chai'
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

    expect(context.localUsers).deep.equals([
      {
        keyLoginEnabled: true,
        lastLogin: undefined,
        loginId: 'BTnpEn7pabDXbcv7VxnKBDsn4CVSwLRA25J8U84qmg4h',
        pinLoginEnabled: true,
        recovery2Key: 'NVADGXzb5Zc55PYXVVT7GRcXPnY9NZJUjiZK8aQnidc',
        username: 'js test 0',
        voucherId: undefined
      }
    ])

    await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  })
})
