// @flow
import type { AbcCurrencyPlugin } from 'airbitz-core-types'

export interface RootState {
  plugins: {
    currencyPlugins: Array<AbcCurrencyPlugin>
  }
}
