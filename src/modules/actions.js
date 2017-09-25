// @flow
import type { FixedIo } from '../io/fixIo.js'

export {
  addCurrencyWallet,
  renameCurrencyWallet,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
} from './currencyWallets/actions.js'

export { setupPlugins } from './plugins/actions.js'

export { addStorageWallet, syncStorageWallet } from './storage/actions.js'

export const INIT: 'airbitz-core-js/INIT' = 'airbitz-core-js/INIT'

/**
 * Initializes the redux store on context creation.
 */
export interface InitAction {
  type: typeof INIT,
  payload: {
    appId: string,
    io: FixedIo,
    onError: (e: Error) => void
  }
}

export type RootAction = InitAction
