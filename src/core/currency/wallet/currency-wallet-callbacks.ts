import { lt } from 'biggystring'
import { asMaybe } from 'cleaners'
import { isPixieShutdownError } from 'redux-pixies'
import { emit } from 'yaob'

import { upgradeCurrencyCode } from '../../../types/type-helpers'
import {
  EdgeConfirmationState,
  EdgeCurrencyEngineCallbacks,
  EdgeStakingStatus,
  EdgeTokenId,
  EdgeTransaction
} from '../../../types/types'
import { compare } from '../../../util/compare'
import { enableTestMode, pushUpdate } from '../../../util/updateQueue'
import {
  getStorageWalletLastChanges,
  hashStorageWalletFilename
} from '../../storage/storage-selectors'
import { combineTxWithFile } from './currency-wallet-api'
import { asIntegerString } from './currency-wallet-cleaners'
import {
  loadAddressFiles,
  loadFiatFile,
  loadNameFile,
  loadTokensFile,
  loadTxFileNames,
  setupNewTxMetadata
} from './currency-wallet-files'
import {
  CurrencyWalletInput,
  CurrencyWalletProps
} from './currency-wallet-pixie'
import { mergeTx, TxidHashes } from './currency-wallet-reducer'
import { uniqueStrings } from './enabled-tokens'

let throttleRateLimitMs = 5000

/**
 * Wraps a transaction-accepting callback with throttling logic.
 * Returns a function that can be called at high frequency, and batches its
 * inputs to only call the real callback every 5 seconds.
 */
function makeThrottledTxCallback(
  input: CurrencyWalletInput,
  callback: (txArray: EdgeTransaction[]) => void
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

  const out: EdgeCurrencyEngineCallbacks = {
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

    onNewTokens(tokenIds: string[]) {
      pushUpdate({
        id: walletId,
        action: 'onNewTokens',
        updateFunc: () => {
          // Before we update redux, figure out what's truly new:
          const { detectedTokenIds, enabledTokenIds } = input.props.walletState
          const enablingTokenIds = uniqueStrings(tokenIds, [
            ...detectedTokenIds,
            ...enabledTokenIds
          ])

          // Update redux:
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_DETECTED_TOKENS',
            payload: {
              detectedTokenIds: tokenIds,
              enablingTokenIds,
              walletId
            }
          })

          // Fire an event to the GUI:
          if (enablingTokenIds.length > 0) {
            const walletApi = input.props?.walletOutput?.walletApi
            if (walletApi != null) {
              emit(walletApi, 'enabledDetectedTokens', enablingTokenIds)
            }
          }
        }
      })
    },

    onUnactivatedTokenIdsChanged(unactivatedTokenIds: string[]) {
      pushUpdate({
        id: walletId,
        action: 'onUnactivatedTokenIdsChanged',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_UNACTIVATED_TOKEN_IDS',
            payload: { unactivatedTokenIds, walletId }
          })
        }
      })
    },

    onBalanceChanged(currencyCode: string, balance: string) {
      const { accountId, currencyInfo, pluginId } = input.props.walletState
      const allTokens =
        input.props.state.accounts[accountId].allTokens[pluginId]

      if (currencyCode === currencyInfo.currencyCode) {
        out.onTokenBalanceChanged(null, balance)
      } else {
        const { tokenId } = upgradeCurrencyCode({
          allTokens,
          currencyInfo,
          currencyCode
        })
        if (tokenId != null) out.onTokenBalanceChanged(tokenId, balance)
      }
    },

    onTokenBalanceChanged(tokenId: EdgeTokenId, balance: string) {
      const clean = asMaybe(asIntegerString)(balance)
      if (clean == null) {
        input.props.onError(
          new Error(
            `Plugin sent bogus balance for ${String(tokenId)}: "${balance}"`
          )
        )
        return
      }
      pushUpdate({
        id: `${walletId}==${String(tokenId)}`,
        action: 'onTokenBalanceChanged',
        updateFunc: () => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
            payload: { balance: clean, tokenId, walletId }
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
          const { txs } = input.props.walletState
          for (const txid of Object.keys(txs)) {
            const reduxTx = txs[txid]
            if (shouldCoreDetermineConfirmations(reduxTx.confirmations)) {
              const { requiredConfirmations } =
                input.props.walletState.currencyInfo
              const { height } = input.props.walletState

              reduxTx.confirmations = determineConfirmations(
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
                null
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
      const { accountId, currencyInfo, pluginId } = input.props.walletState
      const allTokens =
        input.props.state.accounts[accountId].allTokens[pluginId]

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
        if (tx.isSend == null) tx.isSend = lt(tx.nativeAmount, '0')
        if (tx.memos == null) tx.memos = []
        if (tx.tokenId === undefined) {
          const { tokenId } = upgradeCurrencyCode({
            allTokens,
            currencyInfo,
            currencyCode: tx.currencyCode
          })
          tx.tokenId = tokenId ?? null
        }
      }

      // Grab stuff from redux:
      const { state } = input.props
      const { fileNames, txs: reduxTxs } = input.props.walletState

      const txidHashes: TxidHashes = {}
      const changed: EdgeTransaction[] = []
      const created: EdgeTransaction[] = []
      for (const tx of txs) {
        const { txid } = tx

        // DEPRECATE: After all currency plugins implement new Confirmations API
        if (shouldCoreDetermineConfirmations(tx.confirmations)) {
          const { requiredConfirmations } = input.props.walletState.currencyInfo
          const { height } = input.props.walletState

          tx.confirmations = determineConfirmations(
            tx,
            height,
            requiredConfirmations
          )
        }

        // Verify that something has changed:
        const reduxTx = mergeTx(tx, reduxTxs[txid])
        if (compare(reduxTx, reduxTxs[txid]) && tx.metadata == null) continue

        // Ensure the transaction has metadata:
        const txidHash = hashStorageWalletFilename(state, walletId, txid)
        const isNew = tx.isSend ? false : fileNames[txidHash] == null
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
          tx.tokenId
        )
        if (isNew) created.push(combinedTx)
        else if (files[txidHash] != null) changed.push(combinedTx)
        txidHashes[txidHash] = { date: combinedTx.date, txid }
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
    onWcNewContractCall(payload: object) {
      if (input.props.walletOutput.walletApi != null) {
        emit(input.props.walletOutput.walletApi, 'wcNewContractCall', payload)
      }
    },
    onTxidsChanged() {}
  }
  return out
}

/**
 * Monitors a currency wallet for changes and fires appropriate callbacks.
 */
export function watchCurrencyWallet(input: CurrencyWalletInput): void {
  const { walletId } = input.props

  let lastChanges: string[]
  async function checkChanges(props: CurrencyWalletProps): Promise<void> {
    // Check for data changes:
    const changes = getStorageWalletLastChanges(props.state, walletId)
    if (changes !== lastChanges) {
      lastChanges = changes
      await loadTokensFile(input)
      await loadFiatFile(input)
      await loadNameFile(input)
      await loadTxFileNames(input)
      await loadAddressFiles(input)
    }
  }
  function checkChangesLoop(): void {
    input
      .nextProps()
      .then(checkChanges)
      .then(checkChangesLoop, error => {
        if (isPixieShutdownError(error)) return
        input.props.onError(error)
        checkChangesLoop()
      })
  }
  checkChangesLoop()
}

/**
 * Returns true if the core needs to calculate the transaction's confirmation state,
 * because it still depends on the current block height.
 *
 * @deprecated Remove once all currency plugins support the new confirmations API.
 */
const shouldCoreDetermineConfirmations = (
  confirmations: EdgeConfirmationState | undefined
): boolean => {
  return confirmations !== 'confirmed' && confirmations !== 'dropped'
}

export const determineConfirmations = (
  tx: { blockHeight: number }, // Either EdgeTransaction or MergedTransaction
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
