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
      const { state } = input.props
      const existingTxs = input.props.selfState.txs
      const txidHashes = {}
      const files = input.props.selfState.files || {}
      const fileNames = input.props.selfState.fileNames || []
      const defaultCurrency = input.props.selfState.currencyInfo.currencyCode
      const changed = []
      const created = []
      for (const rawTx of txs) {
        const tx = mergeTx(rawTx, defaultCurrency, existingTxs[rawTx.txid])
        const txid = tx.txid
        // If we already have it in the list, make sure something about it has changed:
        if (compare(tx, existingTxs[txid])) continue

        const txidHash = hashStorageWalletFilename(state, walletId, txid)
        const isNew = !fileNames[txidHash]
        const decryptedMetadata = files[txidHash]
        const combinedTx = combineTxWithFile(
          input,
          tx,
          decryptedMetadata,
          rawTx.currencyCode
        )
        if (isNew) {
          setupNewTxMetadata(input, tx).catch(e => input.props.onError(e))
          created.push(combinedTx)
        } else if (decryptedMetadata) {
          changed.push(combinedTx)
        }
        txidHashes[txidHash] = combinedTx.date
      }
      // Side Effect
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_TXS',
        payload: { txs, walletId, txidHashes }
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
