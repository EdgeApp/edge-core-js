import { makeStorageState } from '../storage/storageState.js'

function nop () {}

class CurrencyState {
  constructor (keyInfo, opts, storage) {
    const { callbacks = {}, plugin } = opts
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

    // Currency plugin:
    this.plugin = plugin
    this.engine = plugin.makeEngine(keyInfo, {
      walletLocalFolder: storage.localFolder,
      walletFolder: storage.folder,
      callbacks: {
        onAddressesChecked,
        onBalanceChanged,
        onBlockHeightChanged,
        onTransactionsChanged
      }
    })

    // State:
    this.name = null
  }

  load () {
    const oldName = this.name
    return this.storage.folder
      .file('WalletName.json')
      .getText()
      .then(text => JSON.parse(text).walletName)
      .catch(e => null)
      .then(name => {
        this.name = name
        if (name !== oldName) this.onWalletNameChanged(name)
        return this
      })
  }

  rename (name) {
    return this.storage.folder
      .file('WalletName.json')
      .setText(JSON.stringify({ walletName: name }))
      .then(() => {
        this.name = name
        this.onWalletNameChanged(name)
        return name
      })
  }
}

export function makeCurrencyState (keyInfo, opts = {}) {
  const { io } = opts

  return makeStorageState(keyInfo, { io }).then(storage => {
    const state = new CurrencyState(keyInfo, opts, storage)
    return state.load()
  })
}
