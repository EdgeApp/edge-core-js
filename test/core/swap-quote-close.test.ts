import { expect } from 'chai'
import { describe, it } from 'mocha'

import { wrapQuote } from '../../src/core/swap/swap-api'
import {
  EdgePluginMap,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest
} from '../../src/types/types'

const swapInfo = { pluginId: 'fake', displayName: 'Fake', isDex: false }
const swapPlugins = {
  fake: { swapInfo }
} as unknown as EdgePluginMap<EdgeSwapPlugin>

const makeQuote = (): EdgeSwapQuote =>
  ({
    pluginId: 'fake',
    swapInfo,
    fromNativeAmount: '1',
    toNativeAmount: '1',
    isEstimate: false,
    async approve() {
      throw new Error('not used')
    },
    async close() {}
  }) as unknown as EdgeSwapQuote

const request = {} as unknown as EdgeSwapRequest

describe('wrapQuote close', function () {
  it('releases the shared destination once every quote is closed', async function () {
    // The synthetic destination wallet is shared by every quote one
    // `fetchSwapQuotes` call returns, so it may only be released after the
    // last of them is closed.
    let released = 0
    const release = (): void => {
      released++
    }
    const wrapped = [makeQuote(), makeQuote()].map(quote =>
      wrapQuote(swapPlugins, request, quote, release)
    )

    await wrapped[0].close()
    expect(released).equals(1)
    await wrapped[1].close()
    expect(released).equals(2)
  })

  it('releases once per quote, however many times it is closed', async function () {
    // The release is reference-counted, so a caller that closes the same quote
    // twice must not decrement twice and free the shared wallet early.
    let released = 0
    const wrapped = wrapQuote(swapPlugins, request, makeQuote(), () => {
      released++
    })

    await wrapped.close()
    await wrapped.close()
    expect(released).equals(1)
  })
})
