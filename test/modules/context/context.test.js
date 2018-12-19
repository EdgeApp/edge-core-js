// @flow

import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { makeFakeContexts } from '../../../src/index.js'
import { destroyAllContexts } from '../../../src/modules/root.js'

afterEach(function () {
  destroyAllContexts()
})

const contextOptions = {
  apiKey: '',
  appId: '',
  localFakeUser: true
}

describe('context', function () {
  it('lists usernames', async function () {
    const [context] = await makeFakeContexts(contextOptions)

    expect(await context.listUsernames()).deep.equals(['js test 0'])
  })
})
