// @flow

import type { EdgeCurrencyInfo } from '../../src/edge-core-index.js'

export const fakeCurrencyInfo: EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: 'TEST',
  currencyName: 'test coin',
  pluginName: 'testcoin',
  denominations: [
    { multiplier: '10', name: 'SMALL' },
    { multiplier: '100', name: 'TEST' }
  ],
  walletTypes: ['wallet:fakecoin'],

  // Configuration options:
  defaultSettings: {},
  metaTokens: [
    {
      currencyCode: 'TOKEN',
      currencyName: 'fake token',
      denominations: [{ multiplier: '1000', name: 'TOKEN' }]
    }
  ],

  // Explorers:
  addressExplorer: 'https://edgesecure.co',
  transactionExplorer: 'https://edgesecure.co'
}
