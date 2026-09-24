import { Bridgeable, emit, update } from 'yaob'

import {
  EdgeAccountTxPage,
  EdgeAccountTxQuery,
  EdgeLocalSettings,
  EdgeTransactionStore,
  EdgeTransactionStoreEvents,
  EdgeTx
} from '../../types/types'
import { ApiInput } from '../root-pixie'
import { EdgeAccountDatabase, getAccountDatabase } from './account-database'
import { readDefaultIsoFiat, writeDefaultIsoFiat } from './fiat-materialize'
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
    readDefaultIsoFiat(database.driver).then(
      fiatCode => {
        this._defaultIsoFiat = fiatCode
        update(this)
      },
      () => undefined
    )
  }

  get _database(): EdgeAccountDatabase {
    // The API is only exposed once the database is open, so a throw here is
    // a logout racing a query rather than a missing capability:
    return getAccountDatabase(this._ai, this._accountId)
  }

  get localSettings(): EdgeLocalSettings {
    return { defaultIsoFiat: this._defaultIsoFiat }
  }

  /**
   * Cached because the getter is synchronous across the bridge.
   *
   * Read once when the database opens and updated by the setter, which is the
   * only thing that can change it.
   */
  _defaultIsoFiat: string | undefined

  async changeLocalSettings(
    settings: Partial<EdgeLocalSettings>
  ): Promise<void> {
    const { defaultIsoFiat } = settings
    if (defaultIsoFiat == null) return

    const changed = await writeDefaultIsoFiat(
      this._database.driver,
      defaultIsoFiat
    )
    if (!changed) return

    this._defaultIsoFiat = defaultIsoFiat
    update(this)

    // Everything is blank now, so say so: a reader showing amounts needs to
    // stop showing the old currency's.
    const rows = await this._database.driver.query<{
      wallet_id: string
      txid: string
    }>('SELECT DISTINCT wallet_id, txid FROM tx_asset_idx')
    this._database.changed(
      rows.map(row => ({ walletId: row.wallet_id, txid: row.txid }))
    )
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
