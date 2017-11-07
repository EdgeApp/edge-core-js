// @flow
import type { RootState } from './root-reducer.js'

export { getExchangeRate } from './exchange/selectors.js'

export { scrypt, makeSnrp, userIdSnrp } from './scrypt/selectors.js'

export {
  getStorageWalletLastSync,
  getStorageWalletFolder,
  getStorageWalletLocalFolder,
  hashStorageWalletFilename
} from './storage/selectors.js'

export function getIo (state: RootState) {
  return state.io
}
