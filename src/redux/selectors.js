export * from './currencyWallets/selectors.js'
export * from './exchangeCache/selectors.js'
export * from './plugins/selectors.js'
export * from './scrypt/selectors.js'
export * from './storageWallets/selectors.js'

export function getIo (state) {
  return state.io
}

export function getOnError (state) {
  return state.onError
}
