// @flow

import { isPixieShutdownError } from 'redux-pixies'

import type {
  EdgeAccountCallbacks,
  EdgeCurrencyEngineCallbacks,
  EdgeTransaction
} from '../../../edge-core-index.js'
import { compare } from '../../../util/compare.js'
import {
  getStorageWalletLastChanges,
  hashStorageWalletFilename
} from '../../storage/selectors.js'
import { combineTxWithFile } from './currency-wallet-api.js'
import { loadAllFiles, setupNewTxMetadata } from './currency-wallet-files.js'
import type {
  CurrencyWalletInput,
  CurrencyWalletProps
} from './currency-wallet-pixie.js'
import { mergeTx } from './currency-wallet-reducer.js'

/**
 * Iterates over all the active logins that care about this particular wallet,
 * returning their callbacks.
 */
export function forEachListener (
  input: CurrencyWalletInput,
  f: (callbacks: EdgeAccountCallbacks) => void
) {
  for (const activeLoginId of input.props.state.login.activeLoginIds) {
    const login = input.props.state.login.logins[activeLoginId]
    if (input.props.id in login.allWalletInfos) {
      try {
        f(login.callbacks)
      } catch (e) {
        input.props.onError(e)
      }
    }
  }
}

/**
 * Returns a callback structure suitable for passing to a currency engine.
 */
export function makeCurrencyWalletCallbacks (
  input: CurrencyWalletInput
): EdgeCurrencyEngineCallbacks {
  const walletId = input.props.id

  return {
    onAddressesChecked (ratio: number) {
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_PROGGRESS_RATIO',
        payload: { walletId, ratio }
      })
      forEachListener(input, ({ onAddressesChecked }) => {
        if (onAddressesChecked) {
          onAddressesChecked(walletId, ratio)
        }
      })
    },

    onBalanceChanged (currencyCode: string, balance: string) {
      forEachListener(input, ({ onBalanceChanged }) => {
        if (onBalanceChanged) {
          onBalanceChanged(walletId, currencyCode, balance)
        }
      })
    },

    onBlockHeightChanged (height: number) {
      forEachListener(input, ({ onBlockHeightChanged }) => {
        if (onBlockHeightChanged) {
          onBlockHeightChanged(walletId, height)
        }
      })
    },

    onTransactionsChanged (txs: Array<EdgeTransaction>) {
      // Sanity-check incoming transactions:
      if (!txs) return
      for (const tx of txs) {
        if (
          typeof tx.txid !== 'string' ||
          typeof tx.date !== 'number' ||
          typeof tx.networkFee !== 'string' ||
          typeof tx.blockHeight !== 'number' ||
          typeof tx.nativeAmount !== 'string' ||
          typeof tx.ourReceiveAddresses !== 'object'
        ) {
          input.props.onError(
            new Error('Plugin sent bogus tx: ' + JSON.stringify(tx, null, 2))
          )
          return
        }
      }

      const { state, selfState } = input.props
      const { currencyInfo, files, filesMetadata, txs: existingTxs } = selfState

      const { sortedTransactions, metadata } = filesMetadata
      const { txidHashes = {} } = sortedTransactions
      const { currencyCode, metaTokens = [] } = currencyInfo

      const changed = []
      const created = []
      const changedMetadata = {}
      for (const rawTx of txs) {
        const tx = mergeTx(rawTx, currencyCode, existingTxs[rawTx.txid])
        const txid = tx.txid
        // If we already have it in the list, make sure something about it has changed:
        if (compare(tx, existingTxs[txid])) continue

        const txidHash = hashStorageWalletFilename(state, walletId, txid)
        const fileName = txidHashes[txidHash] && txidHashes[txidHash].fileName
        const txCurrencyCode = rawTx.currencyCode || currencyCode
        // Test if this is a Token transaction
        const token =
          txCurrencyCode !== currencyCode &&
          !!metaTokens.find(
            ({ currencyCode }) => currencyCode === txCurrencyCode
          )
        const newTxMetadata = { token, txidHash, dropped: false }
        // If it's a new Tx, create a new file.
        // If not, try and get as much data as we currently have in redux
        if (!fileName) {
          // Create, save and return the new transaction metadata object
          const file = setupNewTxMetadata(input, tx, newTxMetadata)
          created.push(combineTxWithFile(input, tx, file, txCurrencyCode))
        } else {
          const fileMetadata = metadata[fileName] || {}
          const { creationDate } = fileMetadata
          for (const param in newTxMetadata) {
            if (fileMetadata[param] !== newTxMetadata[param]) {
              changedMetadata[fileName] = { ...fileMetadata, ...newTxMetadata }
              break
            }
          }
          const file = files[txidHash] || {
            txid,
            internal: false,
            creationDate,
            currencies: {}
          }
          changed.push(combineTxWithFile(input, tx, file, txCurrencyCode))
        }
      }

      // Dispatch new Tx's
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_TXS',
        payload: { walletId, txs, filesMetadata: changedMetadata }
      })

      forEachListener(input, ({ onTransactionsChanged, onNewTransactions }) => {
        if (onTransactionsChanged && changed.length) {
          onTransactionsChanged(walletId, changed)
        }
        if (onNewTransactions && created.length) {
          onNewTransactions(walletId, created)
        }
      })
    },

    onTxidsChanged () {}
  }
}

/**
 * Monitors a currency wallet for changes and fires appropriate callbacks.
 */
export function watchCurrencyWallet (input: CurrencyWalletInput) {
  const walletId = input.props.id

  let lastChanges
  let lastName
  function checkChangesLoop (props: CurrencyWalletProps) {
    // Check for name changes:
    const name = props.selfState.name
    if (name !== lastName) {
      lastName = name

      // Call onWalletNameChanged:
      forEachListener(input, ({ onWalletNameChanged }) => {
        if (onWalletNameChanged) {
          onWalletNameChanged(walletId, name)
        }
      })
    }

    // Check for data changes:
    const changes = getStorageWalletLastChanges(props.state, walletId)
    if (changes !== lastChanges) {
      lastChanges = changes

      // Reload our data from disk:
      loadAllFiles(input).catch(e => input.props.onError(e))

      // Call onWalletDataChanged:
      forEachListener(input, ({ onWalletDataChanged }) => {
        if (onWalletDataChanged) {
          onWalletDataChanged(walletId)
        }
      })
    }

    input
      .nextProps()
      .then(checkChangesLoop)
      .catch(e => {
        if (!isPixieShutdownError(e)) input.props.onError(e)
      })
  }
  checkChangesLoop(input.props)
}
