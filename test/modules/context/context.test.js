// @flow

import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { makeFakeContexts } from '../../../src/edge-core-index.js'
import { destroyAllContexts } from '../../../src/modules/root.js'

// Silence console.info:
const consoleHack: any = console // Flow thinks console is read-only
consoleHack.info = () => {}

afterEach(function () {
  destroyAllContexts()
})

describe('context', function () {
  it('lists usernames', async function () {
    const [context] = makeFakeContexts({ localFakeUser: true })

    expect(await context.listUsernames()).deep.equals(['js test 0'])
  })
})
