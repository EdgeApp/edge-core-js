import { EdgeCurrencyPlugin } from '../../src'

export const brokenEnginePlugin: EdgeCurrencyPlugin = {
  currencyInfo: {
    addressExplorer: '',
    currencyCode: 'BORK',
    defaultSettings: {},
    denominations: [],
    displayName: 'Broken Engine',
    chainDisplayName: 'Broken Chain',
    assetDisplayName: 'Broke Coin',
    pluginId: 'broken-engine',
    transactionExplorer: '',
    walletType: 'wallet:broken'
  },

  async makeCurrencyEngine() {
    throw new SyntaxError("I can't do this")
  },

  async makeCurrencyTools() {
    return {
      createPrivateKey() {
        return Promise.resolve({})
      },
      derivePublicKey() {
        return Promise.resolve({})
      },
      getSplittableTypes() {
        return Promise.resolve([])
      },
      parseUri() {
        return Promise.resolve({})
      },
      encodeUri() {
        return Promise.resolve('')
      }
    }
  }
}
