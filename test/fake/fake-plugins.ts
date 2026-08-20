import type { EdgeCorePluginOptions, EdgeNativeIo } from '../../src/index'
import { brokenEnginePlugin } from './fake-broken-engine'
import {
  fakeCurrencyPlugin,
  makeFakeCurrencyPlugin
} from './fake-currency-plugin'
import { fakeSwapPlugin } from './fake-swap-plugin'

export let capturedNativeIo: EdgeNativeIo | undefined

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
  fakeswap: fakeSwapPlugin,
  'native-io-probe': (env: EdgeCorePluginOptions) => {
    capturedNativeIo = env.nativeIo
    return makeFakeCurrencyPlugin({
      assetDisplayName: 'Probe',
      chainDisplayName: 'Probe',
      currencyCode: 'PROBE',
      displayName: 'Probe',
      pluginId: 'native-io-probe',
      walletType: 'wallet:probe'
    })
  }
}
