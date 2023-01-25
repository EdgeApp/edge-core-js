import { isPixieShutdownError } from 'redux-pixies'
import { emit } from 'yaob'

import {
  EdgeCurrencyEngineCallbacks,
  EdgeStakingStatus,
  EdgeTransaction,
  JsonObject
} from '../../../types/types'
import { compare } from '../../../util/compare'
import { enableTestMode, pushUpdate } from '../../../util/updateQueue'
import {
  getStorageWalletLastChanges,
  hashStorageWalletFilename
} from '../../storage/storage-selectors'
import { combineTxWithFile } from './currency-wallet-api'
import { loadAllFiles, setupNewTxMetadata } from './currency-wallet-files'
import {
  CurrencyWalletInput,
  CurrencyWalletProps
} from './currency-wallet-pixie'
import {
  MergedTransaction,
  mergeTx,
  TxidHashes
} from './currency-wallet-reducer'

let throttleRateLimitMs = 5000

/**
 * Wraps a transaction-accepting callback with throttling logic.
 * Returns a function that can be called at high frequency, and batches its
 * inputs to only call the real callback every 5 seconds.
 */
function makeThrottledTxCallback(
  input: CurrencyWalletInput,
  callback: (txArray: EdgeTransaction[]) => unknown
): (txs: EdgeTransaction[]) => void {
  const { log, walletId } = input.props

  let delayCallback = false
  let lastCallbackTime = 0
  let pendingTxs: EdgeTransaction[] = []

  return (txArray: EdgeTransaction[]) => {
    if (delayCallback) {
      log(`throttledTxCallback delay, walletId: ${walletId}`)
      pendingTxs.push(...txArray)
    } else {
      const now = Date.now()
      if (now - lastCallbackTime > throttleRateLimitMs) {
        lastCallbackTime = now
        callback(txArray)
      } else {
        log(`throttledTxCallback delay, walletId: ${walletId}`)
        delayCallback = true
        pendingTxs = txArray
        setTimeout(() => {
          lastCallbackTime = Date.now()
          callback(pendingTxs)
          delayCallback = false
          pendingTxs = []
        }, throttleRateLimitMs)
      }
    }
  }
}

/**
 * Returns a callback structure suitable for passing to a currency engine.
 */
export function makeCurrencyWalletCallbacks(
  input: CurrencyWalletInput
): EdgeCurrencyEngineCallbacks {
  const { walletId } = input.props

  // If this is a unit test, lower throttling to something testable:
  if (walletId === 'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=') {
    throttleRateLimitMs = 25
    enableTestMode()
  }

  const throtteldOnTxChanged = makeThrottledTxCallback(
    input,
    (txArray: EdgeTransaction[]) => {
      if (input.props.walletOutput?.walletApi != null) {
        emit(input.props.walletOutput.walletApi, 'transactionsChanged', txArray)
      }
    }
  )

  const throttledOnNewTx = makeThrottledTxCallback(
    input,
    (txArray: EdgeTransaction[]) => {
      if (input.props.walletOutput?.walletApi != null) {
        emit(input.props.walletOutput.walletApi, 'newTransactions', txArray)
      }
    }
  )

  return {
    onAddressesChecked(ratio: number) {
      pushUpdate({
        id: walletId,
        action: 'onAddressesChecked',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_SYNC_RATIO',
            payload: { ratio, walletId }
          })
        }
      })
    },

    onBalanceChanged(currencyCode: string, balance: string) {
      pushUpdate({
        id: `${walletId}==${currencyCode}`,
        action: 'onBalanceChanged',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
            payload: { balance, currencyCode, walletId }
          })
        }
      })
    },

    // DEPRECATE: After all currency plugins implement new Confirmations API
    onBlockHeightChanged(height: number) {
      pushUpdate({
        id: walletId,
        action: 'onBlockHeightChanged',
        updateFunc: () => {
          // Update transaction confirmation status
          const { txs: reduxTxs } = input.props.walletState
          const txsHack: any = Object.values(reduxTxs)
          const reduxTxsArray: MergedTransaction[] = txsHack
          for (const reduxTx of reduxTxsArray) {
            if (
              reduxTx.confirmations !== 'confirmed' &&
              reduxTx.confirmations !== 'dropped'
            ) {
              const {
                requiredConfirmations
              } = input.props.walletState.currencyInfo
              const { height } = input.props.walletState

              reduxTx.confirmations = validateConfirmations(
                reduxTx,
                height,
                requiredConfirmations
              )

              // Recreate the EdgeTransaction object
              const txidHash = hashStorageWalletFilename(
                input.props.state,
                walletId,
                reduxTx.txid
              )
              const { files } = input.props.walletState
              const changedTx = combineTxWithFile(
                input,
                reduxTx,
                files[txidHash],
                reduxTx.currencyCode
              )

              // Dispatch event to update the redux transaction object
              input.props.dispatch({
                type: 'CHANGE_MERGE_TX',
                payload: { tx: reduxTx }
              })
              // Dispatch event to update the EdgeTransaction object
              throtteldOnTxChanged([changedTx])
            }
          }

          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
            payload: { height, walletId }
          })
        }
      })
    },

    onStakingStatusChanged(stakingStatus: EdgeStakingStatus) {
      pushUpdate({
        id: walletId,
        action: 'onStakingStatusChanged',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_STAKING',
            payload: { stakingStatus, walletId }
          })
        }
      })
    },

    onTransactionsChanged(txs: EdgeTransaction[]) {
      // Sanity-check incoming transactions:
      if (txs == null) return
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
            new Error(`Plugin sent bogus tx: ${JSON.stringify(tx, null, 2)}`)
          )
          return
        }
      }

      // Grab stuff from redux:
      const { state } = input.props
      const {
        fileNames,
        fileNamesLoaded,
        txs: reduxTxs
      } = input.props.walletState
      const defaultCurrency = input.props.walletState.currencyInfo.currencyCode

      const txidHashes: TxidHashes = {}
      const changed: EdgeTransaction[] = []
      const created: EdgeTransaction[] = []
      for (const tx of txs) {
        const { txid } = tx

        // DEPRECATE: After all currency plugins implement new Confirmations API
        if (
          tx.confirmations !== 'confirmed' &&
          tx.confirmations !== 'dropped'
        ) {
          const { requiredConfirmations } = input.props.walletState.currencyInfo
          const { height } = input.props.walletState

          tx.confirmations = validateConfirmations(
            tx,
            height,
            requiredConfirmations
          )
        }

        // Verify that something has changed:
        const reduxTx = mergeTx(tx, defaultCurrency, reduxTxs[txid])
        if (compare(reduxTx, reduxTxs[txid])) continue

        // Ensure the transaction has metadata:
        const txidHash = hashStorageWalletFilename(state, walletId, txid)
        const isNew =
          tx.spendTargets != null ||
          (fileNamesLoaded && fileNames[txidHash] == null)
        if (isNew) {
          setupNewTxMetadata(input, tx).catch(error =>
            input.props.onError(error)
          )
        }

        // Build the final transaction to show the user:
        const { files } = input.props.walletState
        const combinedTx = combineTxWithFile(
          input,
          reduxTx,
          files[txidHash],
          tx.currencyCode
        )
        if (isNew) created.push(combinedTx)
        else if (files[txidHash] != null) changed.push(combinedTx)
        txidHashes[txidHash] = combinedTx.date
      }

      // Tell everyone who cares:
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_TXS',
        payload: { txs, walletId, txidHashes }
      })
      if (changed.length > 0) throtteldOnTxChanged(changed)
      if (created.length > 0) throttledOnNewTx(created)
    },
    onAddressChanged() {
      if (input.props.walletOutput.walletApi != null) {
        emit(input.props.walletOutput.walletApi, 'addressChanged', undefined)
      }
    },
    onWcNewContractCall(payload: JsonObject) {
      if (input.props.walletOutput.walletApi != null) {
        emit(input.props.walletOutput.walletApi, 'wcNewContractCall', payload)
      }
    },
    onTxidsChanged() {}
  }
}

/**
 * Monitors a currency wallet for changes and fires appropriate callbacks.
 */
export function watchCurrencyWallet(input: CurrencyWalletInput): void {
  const { walletId } = input.props

  let lastChanges: string[]
  function checkChangesLoop(props: CurrencyWalletProps): void {
    // Check for data changes:
    const changes = getStorageWalletLastChanges(props.state, walletId)
    if (changes !== lastChanges) {
      lastChanges = changes
      loadAllFiles(input).catch(error => input.props.onError(error))
    }

    input
      .nextProps()
      .then(checkChangesLoop)
      .catch(error => {
        if (!isPixieShutdownError(error)) input.props.onError(error)
      })
  }
  checkChangesLoop(input.props)
}

export const validateConfirmations = (
  tx: EdgeTransaction | MergedTransaction,
  blockHeight: number,
  requiredConfirmations: number = 1 // Default confirmation rule is 1 block
): EdgeTransaction['confirmations'] => {
  // If the transaction has a blockHeight >0, then it has been mined in a block
  if (tx.blockHeight > 0) {
    // Add 1 to the diff because there is 1 confirmation if the tx and network
    // block heights are equal:
    const blockConfirmations = 1 + blockHeight - tx.blockHeight
    // Negative confirmations mean the network blockHeight hasn't caught up:
    if (blockConfirmations <= 0) {
      return 'syncing'
    }
    // Return confirmed if it meets the minimum:
    if (blockConfirmations >= requiredConfirmations) {
      return 'confirmed'
    }
    // Otherwise, return the number of confirmations:
    return blockConfirmations
  }
  // Historically, tx.blockHeight === -1 has meant the transaction has been dropped
  if (tx.blockHeight < 0) {
    return 'dropped'
  }
  // Historically, tx.blockHeight === 0 has meant unconfirmed in our API.
  return 'unconfirmed'
}