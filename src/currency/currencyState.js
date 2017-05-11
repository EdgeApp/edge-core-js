import { makeStorageState } from '../storage/storageState.js'

function nop () {}

class CurrencyState {
  constructor (keyInfo, opts, storage) {
    const { callbacks = {} } = opts
    const {
      onAddressesChecked = nop,
      onBalanceChanged = nop,
      onBlockHeightChanged = nop,
      onDataChanged = nop,
      onNewTransactions = nop,
      onTransactionsChanged = nop,
      onWalletNameChanged = nop
    } = callbacks

    // Callbacks:
    this.onAddressesChecked = onAddressesChecked
    this.onBalanceChanged = onBalanceChanged
    this.onBlockHeightChanged = onBlockHeightChanged
    this.onDataChanged = onDataChanged
    this.onNewTransactions = onNewTransactions
    this.onTransactionsChanged = onTransactionsChanged
    this.onWalletNameChanged = onWalletNameChanged

    // Storage:
    this.storage = storage
    storage.onDataChanged = () => this.load()
  }
}

export function makeCurrencyState (keyInfo, opts = {}) {
  const { io } = opts

  return makeStorageState(keyInfo, { io }).then(
    storage => new CurrencyState(keyInfo, opts, storage)
  )
}
