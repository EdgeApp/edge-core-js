import { expect } from 'chai'
import { describe, it } from 'mocha'

import { fixWalletInfo } from '../../../src/core/login/keys'
import { makeSplitWalletInfo } from '../../../src/core/login/splitting'

describe('splitWalletInfo', function () {
  it('handles bitcoin to bitcoin cash', function () {
    expect(
      makeSplitWalletInfo(
        fixWalletInfo({
          id: 'MPo9EF5krFQNYkxn2I0elOc0XPbs2x7GWjSxtb5c1WU=',
          type: 'wallet:bitcoin',
          keys: {
            bitcoinKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
            dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
            syncKey: 'u8EIdKgxEG8j7buEt96Mq9usQ+k='
          }
        }),
        'wallet:bitcoincash'
      )
    ).deep.equals({
      id: 'SEsXNQxGL/D+8/vsBHJgwf7bAK6/OyR2BfescT7u/i4=',
      type: 'wallet:bitcoincash',
      keys: {
        bitcoincashKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
        dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
        syncKey: 'w3AiUfoTk8vQfAwPayHy/sJDH7E=',
        format: 'bip32'
      }
    })
  })

  it('handles bitcoin cash to bitcoin', function () {
    expect(
      makeSplitWalletInfo(
        {
          id: 'MPo9EF5krFQNYkxn2I0elOc0XPbs2x7GWjSxtb5c1WU=',
          type: 'wallet:bitcoincash',
          keys: {
            bitcoincashKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
            dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
            syncKey: 'u8EIdKgxEG8j7buEt96Mq9usQ+k=',
            format: 'bip44',
            coinType: 145
          }
        },
        'wallet:bitcoin'
      )
    ).deep.equals({
      id: 'SEsXNQxGL/D+8/vsBHJgwf7bAK6/OyR2BfescT7u/i4=',
      type: 'wallet:bitcoin',
      keys: {
        bitcoinKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
        dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
        syncKey: 'w3AiUfoTk8vQfAwPayHy/sJDH7E=',
        format: 'bip44',
        coinType: 145
      }
    })
  })
})
