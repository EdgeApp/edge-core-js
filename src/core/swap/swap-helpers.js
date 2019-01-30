// @flow

import {
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction
} from '../../types/types.js'

export function makeSwapPluginQuote (
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  tx: EdgeTransaction,
  destinationAddress: string,
  pluginName: string,
  expirationDate?: Date,
  quoteId?: string
): EdgeSwapPluginQuote {
  const { fromWallet } = request

  const out: EdgeSwapPluginQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount: tx.networkFee
    },
    destinationAddress,
    pluginName,
    expirationDate,
    quoteId,

    async approve (): Promise<EdgeTransaction> {
      const signedTransaction = await fromWallet.signTx(tx)
      const broadcastedTransaction = await fromWallet.broadcastTx(
        signedTransaction
      )
      await fromWallet.saveTx(signedTransaction)

      return broadcastedTransaction
    },

    async close () {}
  }
  return out
}
