// @flow
import type {
  AbcAccountCallbacks,
  AbcCurrencyPluginCallbacks,
  AbcTransaction
} from 'airbitz-core-types'
import { isPixieShutdownError } from 'redux-pixies'
import { compare } from '../../../util/compare.js'
import { getStorageWalletLastSync } from '../../selectors.js'
import { combineTxWithFile } from './currency-wallet-api.js'
import { loadAllFiles, setupNewTxMetadata } from './currency-wallet-files.js'
import type {
  CurrencyWalletInput,
  CurrencyWalletProps
} from './currency-wallet-pixie.js'
import { mergeTx } from './currency-wallet-reducer.js'

/**
 * Iterates over all the active logins that care about this particular wallet,
 * returing their callbacks.
 */
export function forEachListener (
  input: CurrencyWalletInput,
  f: (callbacks: AbcAccountCallbacks) => void
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
): AbcCurrencyPluginCallbacks {
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

    onTransactionsChanged (txs: Array<AbcTransaction>) {
      if (!txs) return

      const existingTxs = input.props.selfState.txs
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_TXS',
        payload: { txs, walletId }
      })

      const files = input.props.selfState.files
      const defaultCurrency = input.props.selfState.currencyInfo.currencyCode
      const changes = []
      const created = []
      for (const rawTx of txs) {
        const tx = mergeTx(rawTx, defaultCurrency, existingTxs[rawTx.txid])

        const isNew = existingTxs[tx.txid] == null
        if (isNew) {
          setupNewTxMetadata(input, tx).catch(e => input.props.onError(e))
        } else {
          if (compare(tx, existingTxs[tx.txid])) continue
        }

        const list = isNew ? created : changes
        list.push(
          combineTxWithFile(input, tx, files[tx.txid], rawTx.currencyCode)
        )
      }

      if (changes.length) {
        forEachListener(input, ({ onTransactionsChanged }) => {
          if (onTransactionsChanged) {
            onTransactionsChanged(walletId, changes)
          }
        })
      }

      if (created.length) {
        forEachListener(input, ({ onNewTransactions }) => {
          if (onNewTransactions) {
            onNewTransactions(walletId, created)
          }
        })
      }
    }
  }
}

/**
 * Monitors a currency wallet for changes and fires appropriate callbacks.
 */
export function watchCurrencyWallet (input: CurrencyWalletInput) {
  const walletId = input.props.id

  let lastProps = input.props
  function checkChangesLoop (props: CurrencyWalletProps) {
    lastProps = props

    if (props.selfState.name !== lastProps.selfState.name) {
      const name = props.selfState.name

      // Call onWalletNameChanged:
      forEachListener(input, ({ onWalletNameChanged }) => {
        if (onWalletNameChanged) {
          onWalletNameChanged(walletId, name)
        }
      })
    }

    if (
      getStorageWalletLastSync(props.state, walletId) !==
      getStorageWalletLastSync(lastProps.state, walletId)
    ) {
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
