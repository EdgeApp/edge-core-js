import { brokenEnginePlugin } from './fake-broken-engine'
import {
  fakeCurrencyPlugin,
  makeFakeCurrencyPlugin
} from './fake-currency-plugin'
import { fakeSwapPlugin } from './fake-swap-plugin'

export const allPlugins = {
  'broken-plugin': () => {
    throw new Error('Expect to fail')
  },
  'broken-engine': brokenEnginePlugin,
  fakecoin: fakeCurrencyPlugin,
  tulipcoin: makeFakeCurrencyPlugin({
    assetDisplayName: 'Tulip Coin',
    chainDisplayName: 'Tulip Chain',
    currencyCode: 'TULIP',
    displayName: 'Tulip Coin',
    pluginId: 'tulipcoin',
    walletType: 'wallet:tulipcoin'
  }),
  fakeswap: fakeSwapPlugin
}
