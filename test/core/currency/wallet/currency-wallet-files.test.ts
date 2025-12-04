import { expect } from 'chai'
import { describe, it } from 'mocha'

import { TransactionFile } from '../../../../src/core/currency/wallet/currency-wallet-cleaners'
import { isEmptyTxFile } from '../../../../src/core/currency/wallet/currency-wallet-files'

describe('currency wallet files', function () {
  describe('isEmptyTxFile', function () {
    it('returns true for minimal empty file', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map()
      }
      expect(isEmptyTxFile(file)).equals(true)
    })

    it('returns true for file with empty metadata in tokens', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([[null, { metadata: {} }]])
      }
      expect(isEmptyTxFile(file)).equals(true)
    })

    it('returns true for file with empty metadata in currencies', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map([['BTC', { metadata: {} }]]),
        tokens: new Map()
      }
      expect(isEmptyTxFile(file)).equals(true)
    })

    it('returns true for file with empty string metadata fields', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: {
                name: '',
                notes: '',
                category: '',
                exchangeAmount: {}
              }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(true)
    })

    it('returns false for file with savedAction', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        savedAction: {
          actionType: 'swap',
          swapInfo: {
            pluginId: 'test',
            displayName: 'Test',
            supportEmail: 'test@test.com'
          },
          isEstimate: false,
          payoutAddress: '0x123',
          payoutWalletId: 'wallet1',
          fromAsset: { pluginId: 'btc', tokenId: null, nativeAmount: '100' },
          toAsset: { pluginId: 'eth', tokenId: null, nativeAmount: '200' }
        }
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with swap data', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        swap: {
          orderId: '123',
          isEstimate: true,
          plugin: {
            pluginId: 'test',
            displayName: 'Test'
          },
          payoutAddress: '0x123',
          payoutCurrencyCode: 'ETH',
          payoutNativeAmount: '100',
          payoutWalletId: 'wallet1'
        }
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with payees', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        payees: [
          {
            address: '0x123',
            amount: '100',
            currency: 'ETH'
          }
        ]
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns true for file with empty payees array', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        payees: []
      }
      expect(isEmptyTxFile(file)).equals(true)
    })

    it('returns false for file with deviceDescription', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        deviceDescription: 'iPhone 12'
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with secret', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        secret: 'supersecret'
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with feeRateRequested', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        feeRateRequested: 'high'
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with user metadata name', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: { name: 'Coffee Shop' }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with user metadata notes', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: { notes: 'Bought coffee' }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with user metadata category', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: { category: 'expense:Food' }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with user metadata bizId', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: { bizId: 123 }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with user metadata exchangeAmount', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: { exchangeAmount: { 'iso:USD': 5.5 } }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with assetAction in tokens', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: {},
              assetAction: { assetActionType: 'swap' }
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns false for file with assetAction in currencies', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map([
          [
            'BTC',
            {
              metadata: {},
              assetAction: { assetActionType: 'swap' }
            }
          ]
        ]),
        tokens: new Map()
      }
      expect(isEmptyTxFile(file)).equals(false)
    })

    it('returns true for file with feeRateUsed (not user data)', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map(),
        feeRateUsed: { satPerByte: 10 }
      }
      expect(isEmptyTxFile(file)).equals(true)
    })

    it('returns true for file with nativeAmount in tokens (not user data)', function () {
      const file: TransactionFile = {
        txid: 'abc123',
        internal: true,
        creationDate: 1234567890,
        currencies: new Map(),
        tokens: new Map([
          [
            null,
            {
              metadata: {},
              nativeAmount: '1000000'
            }
          ]
        ])
      }
      expect(isEmptyTxFile(file)).equals(true)
    })
  })
})
