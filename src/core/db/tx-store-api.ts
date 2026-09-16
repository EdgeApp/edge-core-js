import { Bridgeable, emit } from 'yaob'

import {
  EdgeAccountTxPage,
  EdgeAccountTxQuery,
  EdgeTransactionStore,
  EdgeTransactionStoreEvents,
  EdgeTx
} from '../../types/types'
import { ApiInput } from '../root-pixie'
import { EdgeAccountDatabase } from './account-database'
import { queryTxPage, readTx, streamTxPages } from './tx-query'

/**
 * The account-wide transaction API.
 *
 * A `Bridgeable`, because on React Native this crosses the yaob bridge into
 * the GUI. That is also why the query surface is page-at-a-time rather than
 * an open cursor: a handle the reader holds would pin native resources across
 * arbitrary GUI code, and a bridge cannot promise to hear about its release.
 */
export class EdgeTransactionStoreApi
  extends Bridgeable<EdgeTransactionStore, EdgeTransactionStoreEvents>
  implements EdgeTransactionStore
{
  _ai: ApiInput
  _accountId: string
  _unsubscribe: (() => void) | undefined

  constructor(ai: ApiInput, accountId: string) {
    super()
    this._ai = ai
    this._accountId = accountId
  }

  /**
   * Starts forwarding change reports.
   *
   * Separate from the constructor because the database is opened after the
   * account API is built, and a listener attached to a database that is not
   * there yet would quietly never fire.
   */
  _watch(database: EdgeAccountDatabase): void {
    if (this._unsubscribe != null) return
    this._unsubscribe = database.onChanged(refs => {
      emit(this, 'transactionsChanged', refs)
    })
  }

  get _database(): EdgeAccountDatabase {
    const database = this._ai.props.output.accounts[this._accountId]?.database
    // The API is only exposed once the database is open, so this is a
    // logout racing a query rather than a missing capability:
    if (database == null) throw new Error('This account is logged out')
    return database
  }

  async queryTxs(query: EdgeAccountTxQuery): Promise<EdgeAccountTxPage> {
    return await queryTxPage(this._database.driver, query)
  }

  async streamTxs(
    query: EdgeAccountTxQuery
  ): Promise<AsyncIterableIterator<EdgeTx[]>> {
    return streamTxPages(this._database.driver, query)
  }

  async getTx(walletId: string, txid: string): Promise<EdgeTx | undefined> {
    return await readTx(this._database.driver, walletId, txid)
  }
}
