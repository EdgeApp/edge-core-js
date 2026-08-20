import { expect } from 'chai'
import { describe, it } from 'mocha'

import { getInternalStuff } from '../../../src/core/context/internal-api'
import { makeFakeWorld } from '../../../src/core/core'
import { makeFakeIo } from '../../../src/index'
import {
  EdgeFetchFunction,
  EdgeFetchOptions,
  EdgeFetchResponse
} from '../../../src/types/types'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('attestation header', function () {
  it('attaches and clears x-attestation-token on login-server requests', async function () {
    // Use unbridged makeFakeWorld so we can spy on the context io.fetch
    // that loginFetchInner calls (makeFakeEdgeWorld's yaob bridge hides `_ai`).
    const world = makeFakeWorld({ io: makeFakeIo(), nativeIo: {} }, quiet, [
      fakeUser
    ])
    const context = await world.makeEdgeContext(contextOptions)

    const stuff = getInternalStuff(context) as any
    const io = stuff._ai.props.io
    const originalFetch: EdgeFetchFunction = io.fetch.bind(io)
    let lastHeaders: EdgeFetchOptions['headers']
    io.fetch = async (
      uri: string,
      opts?: EdgeFetchOptions
    ): Promise<EdgeFetchResponse> => {
      if (uri.includes('/api/')) {
        lastHeaders = opts?.headers
      }
      return await originalFetch(uri, opts)
    }

    await context.setAttestationToken('jwt')
    await context.usernameAvailable('unknown user')
    expect(lastHeaders?.['x-attestation-token']).equals('jwt')

    await context.setAttestationToken(undefined)
    await context.usernameAvailable('unknown user')
    expect(lastHeaders).to.not.have.property('x-attestation-token')

    await context.setAttestationToken('jwt-again')
    await context.usernameAvailable('unknown user')
    expect(lastHeaders?.['x-attestation-token']).equals('jwt-again')

    await context.setAttestationToken('')
    await context.usernameAvailable('unknown user')
    expect(lastHeaders).to.not.have.property('x-attestation-token')
  })
})
