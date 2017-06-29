import { createReaction, reactionMiddleware } from '../../src/util/reaction.js'
import { applyMiddleware, combineReducers, createStore } from 'redux'

function nop () {}

const reducer = combineReducers({
  balance: (state = 0, action) =>
    (action.type === 'SET_BALANCE' ? action.payload : state),

  blockHeight: (state = 0, action) =>
    (action.type === 'SET_BLOCK_HEIGHT' ? action.payload : state),

  txs: (state = [], action) =>
    (action.type === 'SET_TXS' ? action.payload : state)
})

export function makeFakeCurrencyStore () {
  return createStore(reducer, applyMiddleware(reactionMiddleware))
}

/**
 * Currency plugin transaction engine.
 */
class FakeCurrencyEngine {
  constructor (store, keyInfo, opts) {
    this.store = store

    const { callbacks } = opts
    const {
      onAddressesChecked = nop,
      onBalanceChanged = nop,
      onBlockHeightChanged = nop,
      onTransactionsChanged = nop
    } = callbacks

    // Address callback:
    this.onAddressesChecked = onAddressesChecked

    // Balance callback:
    this.store.dispatch(
      createReaction(state => state.balance, onBalanceChanged)
    )

    // Block height callback:
    this.store.dispatch(
      createReaction(state => state.blockHeight, onBlockHeightChanged)
    )

    // Transactions callback:
    const oldTxs = {}
    this.store.dispatch(
      createReaction(
        state => state.txs,
        txs => {
          // Build the list of changed transactions:
          const changed = []
          for (const tx of txs) {
            if (oldTxs[tx.txid] !== tx) changed.push(tx)
          }
          onTransactionsChanged(changed)

          // Save the new list of transactions:
          for (const tx of txs) {
            oldTxs[tx.txid] = tx
          }
        }
      )
    )
  }

  startEngine () {
    return Promise.resolve()
  }

  stopEngine () {
    for (const disposer of this.disposers) {
      disposer()
    }
    return Promise.resolve()
  }

  getBalance (opts = {}) {
    return this.store.getState().balance
  }

  getBlockHeight () {
    return this.store.getState().blockHeight
  }

  getNumTransactions () {
    return this.store.getState().txs.length
  }

  getTransactions () {
    return Promise.resolve(this.store.getState().txs)
  }

  saveTx () {
    return Promise.resolve()
  }
}

/**
 * Currency plugin setup object.
 */
class FakeCurrencyPlugin {
  constructor (store) {
    this.store = store
  }

  getInfo () {
    return {}
  }

  makeEngine (keyInfo, opts = {}) {
    return new FakeCurrencyEngine(this.store, keyInfo, opts)
  }
}

/**
 * Creates a currency plugin setup object
 * @param store Redux store for the engine to use.
 */
export function makeFakeCurrency (store = makeFakeCurrencyStore()) {
  return new FakeCurrencyPlugin(store)
}
