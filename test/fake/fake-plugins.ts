import { brokenEnginePlugin } from './fake-broken-engine'
import { fakeCurrencyPlugin } from './fake-currency-plugin'
import { fakeSwapPlugin } from './fake-swap-plugin'

export const allPlugins = {
  'broken-plugin': () => {
    throw new Error('Expect to fail')
  },
  'broken-engine': brokenEnginePlugin,
  fakecoin: fakeCurrencyPlugin,
  fakeswap: fakeSwapPlugin
}
