import { makeReaction, makeStore } from '../../src/util/derive.js'

function nop () {}

/**
 * Currency plugin transaction engine.
 */
class FakeCurrencyEngine {
  constructor (stores, keyInfo, opts) {
    const {
      balance = makeStore(0),
      blockHeight = makeStore(0),
      txs = makeStore([])
    } = stores

    const { callbacks } = opts
    const {
      onAddressesChecked = nop,
      onBalanceChanged = nop,
      onBlockHeightChanged = nop,
      onTransactionsChanged = nop
    } = callbacks

    // Save store objects:
    this.balance = balance
    this.blockHeight = blockHeight
    this.txs = txs
    this.disposers = []

    // Address callback:
    this.onAddressesChecked = onAddressesChecked

    // Balance callback:
    this.disposers.push(makeReaction(() => onBalanceChanged(balance())))

    // Block height callback:
    this.disposers.push(makeReaction(() => onBlockHeightChanged(blockHeight())))

    // Transactions callback:
    const oldTxs = {}
    this.disposers.push(
      makeReaction(() => {
        const txs = this.txs()

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
      })
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
    return this.balance()
  }

  getBlockHeight () {
    return this.blockHeight()
  }

  getNumTransactions () {
    return this.txs().length
  }

  getTransactions () {
    return Promise.resolve(this.txs())
  }
}

/**
 * Currency plugin setup object.
 */
class FakeCurrencyPlugin {
  constructor (stores) {
    this.stores = stores
  }

  getInfo () {
    return {}
  }

  makeEngine (keyInfo, opts = {}) {
    return new FakeCurrencyEngine(this.stores, keyInfo, opts)
  }
}

/**
 * Creates a currency plugin setup object
 * @param {*} opts Accepts stores for balance, blockHeight, and txs.
 */
export function makeFakeCurrency (stores = {}) {
  return new FakeCurrencyPlugin(stores)
}
