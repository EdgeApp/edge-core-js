import { expect } from 'chai'
import { describe, it } from 'mocha'

import { validateConfirmations } from '../../../src/core/currency/wallet/currency-wallet-callbacks'

describe('confirmations API', function () {
  const helper = (
    txBlockHeight: number,
    netBlockHeight: number,
    required: number,
    expected: string
  ): void => {
    const tx = { blockHeight: txBlockHeight }
    expect(
      validateConfirmations(tx, netBlockHeight, required),
      `Expected tx with blockHeight of ${txBlockHeight} to be ${expected} at network blockHeight ${netBlockHeight} with ${required} required confs`
    ).equals(expected)
  }

  it('correctly resolves to unconfirmed', function () {
    const txBlockHeight = 0
    for (let blockHeight = 1; blockHeight <= 100; ++blockHeight) {
      for (let required = 1; required <= 10; ++required) {
        helper(txBlockHeight, blockHeight, required, 'unconfirmed')
      }
    }
  })
  it('correctly resolves to confirmed', function () {
    for (let required = 0; required <= 10; ++required) {
      for (
        let blockHeight = 100;
        blockHeight <= 100 + required;
        ++blockHeight
      ) {
        const txBlockHeight = blockHeight - Math.max(0, required - 1) // Subtract 1 because same blockHeights counts as 1 conf
        helper(txBlockHeight, blockHeight, required, 'confirmed')
      }
    }
  })
  it('correctly resolves to syncing', function () {
    const txBlockHeight = 1000
    for (let blockHeight = -1; blockHeight <= 100; ++blockHeight) {
      for (let required = 0; required <= 10; ++required) {
        helper(0, blockHeight, required, 'unconfirmed')
        helper(txBlockHeight, blockHeight, required, 'syncing')
      }
    }
  })
  it('correctly resolves to dropped', function () {
    const txBlockHeight = -1
    for (let blockHeight = -1; blockHeight <= 100; ++blockHeight) {
      for (let required = 0; required <= 10; ++required) {
        helper(txBlockHeight, blockHeight, required, 'dropped')
      }
    }
  })
})
