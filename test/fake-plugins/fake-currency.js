import { add, lt } from 'biggystring'
import { applyMiddleware, combineReducers, createStore } from 'redux'

import { InsufficientFundsError } from '../../src/error.js'
import {
  createReaction,
  reactionMiddleware
} from '../../src/util/redux/reaction.js'
import { fakeCurrencyInfo } from './fake-currency-info.js'

function nop () {}

const reducer = combineReducers({
  balance: (state = 0, action) =>
    action.type === 'SET_BALANCE' ? action.payload : state,

  tokenBalance: (state = 0, action) =>
    action.type === 'SET_TOKEN_BALANCE' ? action.payload : state,

  blockHeight: (state = 0, action) =>
    action.type === 'SET_BLOCK_HEIGHT' ? action.payload : state,

  progress: (state = 0, action) =>
    action.type === 'SET_PROGRESS' ? action.payload : state,

  txs: (state = [], action) => {
    if (action.type === 'SET_TXS') {
      const out = []
      for (const tx of action.payload) {
        out.push({
          txid: '',
          date: 0,
          networkFee: '0',
          blockHeight: 0,
          nativeAmount: '0',
          ourReceiveAddresses: [],
          ...tx
        })
      }
      return out
    }
    return state
  }
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
    this.store.dispatch(
      createReaction(state => state.progress, onAddressesChecked)
    )

    // Balance callback:
    this.store.dispatch(
      createReaction(
        state => state.balance,
        balance => onBalanceChanged('TEST', balance.toString())
      )
    )

    // Token balance callback:
    this.store.dispatch(
      createReaction(
        state => state.tokenBalance,
        balance => onBalanceChanged('TOKEN', balance.toString())
      )
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

  killEngine () {
    return Promise.resolve()
  }

  getBalance (opts = {}) {
    const { currencyCode = 'TEST' } = opts
    switch (currencyCode) {
      case 'TEST':
        return this.store.getState().balance.toString()
      case 'TOKEN':
        return this.store.getState().tokenBalance.toString()
      default:
        throw new Error('Unknown currency')
    }
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

  resyncBlockchain () {
    return Promise.resolve()
  }

  dumpData () {
    return ''
  }

  getDisplayPrivateSeed () {
    return 'xpriv'
  }

  getDisplayPublicSeed () {
    return 'xpub'
  }

  makeSpend (spendInfo) {
    const { currencyCode = 'TEST', spendTargets } = spendInfo

    // Check the spend targets:
    let total = '0'
    for (const spendTarget of spendTargets) {
      total = add(total, spendTarget.nativeAmount)
    }

    // Check the balances:
    if (lt(this.getBalance(currencyCode), total)) {
      return Promise.reject(new InsufficientFundsError())
    }

    // TODO: Return a high-fidelity transaction
    return Promise.resolve({ currencyCode })
  }
}

/**
 * Currency plugin setup object.
 */
class FakeCurrencyPlugin {
  constructor (store) {
    this.store = store
  }

  get pluginName () {
    return fakeCurrencyInfo.pluginName
  }

  get currencyInfo () {
    return fakeCurrencyInfo
  }

  createPrivateKey (type) {
    if (type !== this.currencyInfo.walletTypes[0]) {
      throw new Error('Unsupported key type')
    }
    return {
      fakeKey: 'FakePrivateKey'
    }
  }

  // derivePublicKey () {}
  // parseUri () {}

  makeEngine (keyInfo, opts = {}) {
    return Promise.resolve(new FakeCurrencyEngine(this.store, keyInfo, opts))
  }

  getSplittableTypes (walletInfo) {
    return ['wallet:tulipcoin']
  }
}

/**
 * Creates a currency plugin setup object
 * @param store Redux store for the engine to use.
 */
export function makeFakeCurrency (store = makeFakeCurrencyStore()) {
  return {
    pluginType: 'currency',

    makePlugin (io) {
      return Promise.resolve(new FakeCurrencyPlugin(store))
    }
  }
}
