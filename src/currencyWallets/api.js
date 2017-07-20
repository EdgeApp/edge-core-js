import {
  addCurrencyWallet,
  renameCurrencyWallet,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
} from '../redux/actions.js'
import {
  getCurrencyWalletBalance,
  getCurrencyWalletBlockHeight,
  getCurrencyWalletEngine,
  getCurrencyWalletFiat,
  getCurrencyWalletFiles,
  getCurrencyWalletName,
  getCurrencyWalletPlugin,
  getCurrencyWalletProgress,
  getCurrencyWalletTxList,
  getCurrencyWalletTxs,
  getStorageWalletLastSync
} from '../redux/selectors.js'
import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { createReaction } from '../util/reaction.js'
import { compare } from '../util/recycle.js'
import { filterObject, mergeDeeply } from '../util/util.js'

function nop () {}

const fakeMetadata = {
  bizId: 0,
  category: '',
  exchangeAmount: {},
  name: '',
  notes: ''
}

/**
 * Creates a `CurrencyWallet` API object.
 */
export function makeCurrencyWallet (keyInfo, opts) {
  const { io, callbacks = {} } = opts
  const { redux } = io

  return redux
    .dispatch(addCurrencyWallet(keyInfo, opts))
    .then(keyId =>
      wrapObject(
        io.onError,
        'CurrencyWallet',
        makeCurrencyApi(redux, keyInfo, callbacks)
      )
    )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeCurrencyApi (redux, keyInfo, callbacks) {
  const { dispatch, getState } = redux
  const keyId = keyInfo.id

  // Bound selectors:
  const engine = () => getCurrencyWalletEngine(getState(), keyId)
  const plugin = () => getCurrencyWalletPlugin(getState(), keyId)

  const {
    onAddressesChecked,
    onBalanceChanged,
    onBlockHeightChanged,
    onDataChanged,
    onNewTransactions = nop,
    onTransactionsChanged = nop,
    onWalletNameChanged
  } = callbacks

  // Hook up engine callbacks:
  if (onAddressesChecked) {
    dispatch(
      createReaction(
        state => getCurrencyWalletProgress(state, keyId),
        onAddressesChecked
      )
    )
  }

  if (onBalanceChanged) {
    dispatch(
      createReaction(
        state => getCurrencyWalletBalance(state, keyId),
        balance => onBalanceChanged(balance.currencyCode, balance.balance)
      )
    )
  }

  if (onBlockHeightChanged) {
    dispatch(
      createReaction(
        state => getCurrencyWalletBlockHeight(state, keyId),
        onBlockHeightChanged
      )
    )
  }

  // Hook up storage callback:
  if (onDataChanged) {
    dispatch(
      createReaction(
        state => getStorageWalletLastSync(state, keyId),
        timestamp => onDataChanged()
      )
    )
  }

  // Hook up the `onTransactionsChanged` and `onNewTransactions` callbacks:
  let inhibit = false
  dispatch(
    createReaction(
      state => getCurrencyWalletFiles(state, keyId),
      state => getCurrencyWalletTxs(state, keyId),
      state => getCurrencyWalletTxList(state, keyId),
      (files, txs, list, oldFiles = {}, oldTxs = {}) => {
        if (inhibit) return
        inhibit = true

        const changes = []
        const created = []

        // Diff the transaction list:
        for (const info of list) {
          if (
            !compare(txs[info.txid], oldTxs[info.txid]) ||
            !compare(files[info.txid], oldFiles[info.txid])
          ) {
            // If we have no metadata, it's new:
            if (files[info.txid] == null) {
              dispatch(setupNewTxMetadata(keyId, txs[info.txid]))
              created.push(info.txid)
            } else {
              changes.push(info.txid)
            }
          }
        }

        if (changes.length) onTransactionsChanged(changes)
        if (created.length) onNewTransactions(created)
        inhibit = false
      }
    )
  )

  // Hook up the `onWalletNameChanged` callback:
  if (onWalletNameChanged) {
    dispatch(
      createReaction(
        state => getCurrencyWalletName(state, keyId),
        onWalletNameChanged
      )
    )
  }

  const out = {
    // Storage stuff:
    get name () {
      return getCurrencyWalletName(getState(), keyId)
    },
    renameWallet (name) {
      return dispatch(renameCurrencyWallet(keyId, name))
    },

    // Currency info:
    get fiatCurrencyCode () {
      return getCurrencyWalletFiat(getState(), keyId)
    },
    get currencyInfo () {
      return plugin().currencyInfo
    },

    // Running state:
    startEngine () {
      return engine().startEngine()
    },

    stopEngine () {
      return Promise.resolve(engine().killEngine())
    },

    // Transactions:
    '@getBalance': { sync: true },
    getBalance (opts) {
      return engine().getBalance(opts)
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return engine().getBlockHeight()
    },

    getTransactions (opts = {}) {
      const state = getState()
      const files = getCurrencyWalletFiles(state, keyId)
      const list = getCurrencyWalletTxList(state, keyId)
      const txs = getCurrencyWalletTxs(state, keyId)
      const defaultCurrency = plugin().currencyInfo.currencyCode
      const currencyCode = opts.currencyCode || defaultCurrency

      const outList = []
      for (const info of list) {
        const tx = txs[info.txid]
        const file = files[info.txid]

        // Skip irrelevant transactions:
        if (!tx.nativeAmount[currencyCode] && !tx.networkFee[currencyCode]) {
          continue
        }

        // Copy the tx properties to the output:
        const out = {
          ...tx,
          amountSatoshi: Number(tx.nativeAmount[currencyCode]),
          nativeAmount: tx.nativeAmount[currencyCode],
          networkFee: tx.networkFee[currencyCode]
        }

        // These are our fallback values:
        const fallbackFile = {
          currencies: {}
        }
        fallbackFile.currencies[defaultCurrency] = {
          providerFreeSent: 0,
          metadata: {
            name: '',
            category: '',
            notes: '',
            bizId: 0,
            exchangeAmounts: {}
          }
        }

        // Copy the appropriate metadata to the output:
        if (file) {
          const merged = mergeDeeply(
            fallbackFile,
            file.currencies[defaultCurrency],
            file.currencies[currencyCode]
          )

          if (file.creationDate < out.date) out.date = file.creationDate
          out.providerFee = merged.providerFeeSent
          out.metadata = merged.metadata
        }

        outList.push(out)
      }

      // TODO: Handle the sort within the tx list merge process:
      return Promise.resolve(outList.sort((a, b) => a.date - b.date))
    },

    getReceiveAddress (opts) {
      return Promise.resolve({
        publicAddress: engine().getFreshAddress(opts),
        amountSatoshi: 0,
        metadata: fakeMetadata
      })
    },

    saveReceiveAddress (receiveAddress) {
      return Promise.resolve()
    },

    lockReceiveAddress (receiveAddress) {
      return Promise.resolve()
    },

    '@makeAddressQrCode': { sync: true },
    makeAddressQrCode (address) {
      return address.publicAddress
    },

    '@makeAddressUri': { sync: true },
    makeAddressUri (address) {
      return address.publicAddress
    },

    makeSpend (spendInfo) {
      return engine().makeSpend(spendInfo)
    },

    signTx (tx) {
      return engine().signTx(tx)
    },

    broadcastTx (tx) {
      return engine().broadcastTx(tx)
    },

    saveTx (tx) {
      const defaultCurrency = plugin().currencyInfo.currencyCode
      const currencyCode = tx.currencyCode || defaultCurrency

      return Promise.all([
        engine().saveTx(tx),
        out.saveTxMetadata(tx.txid, currencyCode, tx.metadata)
      ])
    },

    saveTxMetadata (txid, currencyCode, metadata) {
      return dispatch(
        setCurrencyWalletTxMetadata(
          keyId,
          txid,
          currencyCode,
          filterObject(metadata, [
            'bizId',
            'category',
            'exchangeAmount',
            'name',
            'notes'
          ])
        )
      )
    },

    getMaxSpendable (spendInfo) {
      return Promise.resolve(0)
    },

    sweepPrivateKey (keyUri) {
      return Promise.resolve(0)
    }
  }
  copyProperties(out, makeStorageWalletApi(redux, keyInfo, callbacks))

  return out
}
