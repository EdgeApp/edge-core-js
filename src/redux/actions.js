// @flow
export {
  addCurrencyWallet,
  renameCurrencyWallet,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
} from './currencyWallets/actions.js'

export { setupPlugins } from './plugins/actions.js'

export { initStore, INIT } from './rootReducer.js'

export {
  addStorageWallet,
  syncStorageWallet
} from './storageWallets/actions.js'
