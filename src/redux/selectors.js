// @flow
import type { RootState } from './rootReducer.js'

export {
  getCurrencyWalletEngine,
  getCurrencyWalletPlugin,
  getCurrencyWalletBalance,
  getCurrencyWalletBlockHeight,
  getCurrencyWalletName,
  getCurrencyWalletFiat,
  getCurrencyWalletFile,
  getCurrencyWalletProgress,
  getCurrencyWalletFiles,
  getCurrencyWalletTxList,
  getCurrencyWalletTxs
} from './currencyWallets/selectors.js'

export { getExchangeRate } from './exchangeCache/selectors.js'

export {
  getCurrencyPlugins,
  getCurrencyPlugin,
  hasCurrencyPlugin,
  getCurrencyMultiplier,
  getExchangePlugins,
  awaitPluginsLoaded
} from './plugins/selectors.js'

export { scrypt, makeSnrp, userIdSnrp } from './scrypt/selectors.js'

export {
  getStorageWalletLastSync,
  getStorageWalletFolder,
  getStorageWalletLocalFolder,
  hashStorageWalletFilename
} from './storageWallets/selectors.js'

export function getIo (state: RootState) {
  return state.io
}

export function getOnError (state: RootState) {
  return state.onError
}
