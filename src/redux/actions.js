export * from './currencyWallets/actions.js'
export * from './exchangeCache/actions.js'
export * from './plugins/actions.js'
export * from './storageWallets/actions.js'

export const INIT = 'airbitz-core-js/INIT'

/**
 * Initializes the redux store on context creation.
 * @param {*} opts Options passed in to the `createContext` function.
 */
export function initStore (io) {
  return { type: INIT, payload: { io } }
}
