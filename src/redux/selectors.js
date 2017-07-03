export * from './currencyWallets/selectors.js'
export * from './plugins/selectors.js'
export * from './storageWallets/selectors.js'

export function getIo (state) {
  return state.io
}
