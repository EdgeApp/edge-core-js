import { loadTxFiles } from '../currency/wallet/currency-wallet-files'
import { CurrencyWalletInput } from '../currency/wallet/currency-wallet-pixie'
import { getAccountDatabase } from './account-database'
import { txMetaStatements } from './meta-writer'
import { resolveWalletPrefixes, walletRowStatement } from './wallet-store'

/**
 * Copying a wallet's existing metadata files into `tx_meta`, once.
 *
 * A sync only carries the files that changed since the repo's last hash, so a
 * database that is new while the repo is not -- an upgrade, a rebuild, a
 * database deleted and recreated -- starts with an empty `tx_meta` that no
 * sync will ever fill. This fills it, once per wallet, and marks the wallet
 * row so it never runs again.
 */

export const txMetaMirrorConfig = {
  /** Files read and written per transaction. */
  chunkSize: 50,
  /** Test hook: runs before each chunk; throwing stops the mirror there. */
  beforeChunk: undefined as ((index: number) => void) | undefined
}

export async function mirrorAllTxMeta(
  input: CurrencyWalletInput
): Promise<void> {
  const { walletId } = input.props
  const { accountId, currencyInfo, pluginId } = input.props.walletState
  const database = getAccountDatabase(input, accountId)
  const { driver } = database

  // A wallet with no row yet has never been mirrored either:
  const rows = await driver.query<{ meta_mirrored: number }>(
    'SELECT meta_mirrored FROM wallet WHERE wallet_id = ?',
    [walletId]
  )
  if (rows[0]?.meta_mirrored === 1) return

  const txidHashes = Object.keys(input.props.walletState.fileNames)
  const { chunkSize } = txMetaMirrorConfig
  let index = 0
  for (let start = 0; ; start += chunkSize, ++index) {
    txMetaMirrorConfig.beforeChunk?.(index)
    const chunk = txidHashes.slice(start, start + chunkSize)
    const files = await loadTxFiles(input, chunk)
    const writes = Object.keys(files).map(txidHash => ({
      txid: files[txidHash].txid,
      file: files[txidHash]
    }))

    // Insert, never replace: the wallet is in use while this runs, so an
    // edit or a sync that lands between the read above and the write below
    // is newer than the file it read -- and a row whose file write failed
    // has to keep the flag that gets it retried:
    const statements = txMetaStatements(
      walletId,
      currencyInfo.currencyCode,
      writes,
      { conflict: 'insert' }
    )

    // The flag lands in the same transaction as the last chunk, so a kill
    // anywhere before it leaves the wallet unmarked and the next start
    // goes again:
    const last = start + chunkSize >= txidHashes.length
    if (last) {
      const prefixes = await resolveWalletPrefixes(driver, [walletId])
      statements.push(
        walletRowStatement(walletId, prefixes.get(walletId) as string, {
          pluginId,
          metaMirrored: true
        })
      )
    }
    if (statements.length > 0) await driver.batch(statements)

    // A reader that streamed these with no metadata learns they have some:
    if (writes.length > 0) {
      database.changed(writes.map(write => ({ walletId, txid: write.txid })))
    }
    if (last) return
  }
}
