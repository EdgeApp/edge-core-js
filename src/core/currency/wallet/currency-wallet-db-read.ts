import { abs, lt } from 'biggystring'
import { bridgifyObject } from 'yaob'

import { InternalWalletStream } from '../../../client-side'
import { fromEdgeTx } from '../../../types/tx-convert'
import {
  EdgeStreamTransactionOptions,
  EdgeTokenId,
  EdgeTransaction,
  EdgeTx
} from '../../../types/types'
import { EdgeSqlDriver } from '../../db/db-driver'
import { queryTxPage } from '../../db/tx-query'
import {
  determineConfirmations,
  shouldCoreDetermineConfirmations
} from './currency-wallet-callbacks'
import { CurrencyWalletInput } from './currency-wallet-pixie'

/**
 * Reading a wallet's transactions out of the database.
 *
 * The path this replaces walked every txid the engine had ever reported,
 * opened a metadata file per transaction, and filtered in JavaScript -- so
 * the cost of the first page grew with the size of the wallet rather than
 * with the size of the page. Here the predicates are the query's, the order
 * is an index's, and the page is a page.
 *
 * Both halves of a transaction come back from one read; see `tx-meta-merge`.
 */

/** The database is the whole state, so there is nothing to load first. */
export function streamTxsFromDatabase(
  input: CurrencyWalletInput,
  driver: EdgeSqlDriver,
  opts: EdgeStreamTransactionOptions & { currencyCode: string }
): InternalWalletStream {
  const {
    afterDate,
    batchSize = 10,
    beforeDate,
    currencyCode,
    firstBatchSize = batchSize,
    searchString,
    spamThreshold = '0',
    tokenId = null
  } = opts

  const { walletId } = input.props

  let after: string | undefined
  let exhausted = false
  let isFirst = true

  return bridgifyObject({
    async next() {
      const wanted = isFirst ? firstBatchSize : batchSize
      isFirst = false

      const out: EdgeTransaction[] = []
      while (!exhausted && out.length < wanted) {
        const page = await queryTxPage(driver, {
          // Scoped from the wallet this stream belongs to, never from opts:
          walletIds: [walletId],
          tokenIds: [tokenId],
          afterDate,
          beforeDate,
          searchString,
          limit: wanted,
          after
        })

        after = page.cursor
        if (after == null) exhausted = true

        for (const tx of page.transactions) {
          const edgeTx = toEdgeTransaction(input, tx, tokenId, currencyCode)
          if (isSpam(edgeTx, spamThreshold)) continue
          out.push(edgeTx)
        }
      }

      return { done: out.length === 0, value: out }
    }
  })
}

/** How many transactions this wallet holds for one asset. */
export async function countTxsInDatabase(
  input: CurrencyWalletInput,
  driver: EdgeSqlDriver,
  tokenId: EdgeTokenId
): Promise<number> {
  const page = await queryTxPage(driver, {
    walletIds: [input.props.walletId],
    tokenIds: [tokenId],
    details: 'summary'
  })
  return page.summary?.count ?? 0
}

/**
 * One asset's view of a stored transaction, as a reader still expects it.
 *
 * `confirmations` is worked out here rather than stored, because it follows
 * from this transaction's height and the wallet's -- storing it would stale
 * every transaction in the wallet each time a block arrived. The two states
 * no height implies travel in `chainStatus`, and `fromEdgeTx` has already
 * put those back.
 */
export function toEdgeTransaction(
  input: CurrencyWalletInput,
  tx: EdgeTx,
  tokenId: EdgeTokenId,
  currencyCode: string
): EdgeTransaction {
  const { currencyInfo } = input.props.walletState

  const out = fromEdgeTx(tx, tokenId, currencyCode)
  if (shouldCoreDetermineConfirmations(out.confirmations)) {
    out.confirmations = determineConfirmations(
      out,
      input.props.walletState.height,
      currencyInfo.requiredConfirmations
    )
  }

  // Readers have always been handed an object here rather than nothing, and
  // a transaction with no metadata is the ordinary case:
  if (out.metadata == null) out.metadata = {}

  return out
}

/**
 * Transactions too small to be anything but noise.
 *
 * A dust payment from a stranger is spam; the same amount in a transaction
 * this wallet sent, or one carrying an action, is not -- so the test is about
 * what is known about the transaction, not only about its size.
 */
function isSpam(tx: EdgeTransaction, spamThreshold: string): boolean {
  const isKnown =
    tx.isSend ||
    tx.assetAction != null ||
    tx.chainAction != null ||
    tx.chainAssetAction != null ||
    tx.savedAction != null
  return !isKnown && lt(abs(tx.nativeAmount), spamThreshold)
}
