import { EdgeScratchDatabase } from '../../types/types'
import { EdgeInternalIo } from './db-driver'
import { prepareDatabase } from './db-open'
import { ensureOwnerPrefix } from './plugin-tables'
import { makeTxDatabase } from './tx-database-api'

export const scratchDatabaseHooks = {
  /** Test hook: runs once the file is open; throwing fails the open. */
  afterOpen: undefined as (() => void) | undefined
}

/**
 * Throwaway storage, for a wallet that is not the user's.
 *
 * Sweeping a private key builds a wallet, syncs it, spends it and forgets it.
 * That wallet's transactions must not land in the user's own history, so it
 * cannot share the account database -- and it needs the same schema and the
 * same API, so a plugin does not carry a second storage layer just for this.
 *
 * A separate file is what makes both true. It is keyed like any other
 * database, and deleted when closed: nothing about the imported key is left
 * behind, which matters more here than anywhere else in this design.
 */
export async function makeScratchDatabase(
  io: EdgeInternalIo,
  pluginId: string
): Promise<EdgeScratchDatabase> {
  const { makeSqlDriver, deleteSqlDatabase } = io
  if (makeSqlDriver == null) {
    throw new Error('This platform cannot open a scratch database')
  }

  // Random, so two sweeps at once cannot collide, and so nothing can be
  // recognised as belonging to a particular account afterwards.
  const suffix = [...io.random(16)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  const name = `scratch-${suffix}`
  const walletId = Buffer.from(io.random(32)).toString('base64')

  const driver = await makeSqlDriver(name, io.random(32))
  try {
    scratchDatabaseHooks.afterOpen?.()
    await prepareDatabase(driver)
    const prefix = await ensureOwnerPrefix(driver, 'wallet', walletId, pluginId)
    const database = makeTxDatabase({ driver, walletId, pluginId, prefix })

    return {
      ...database,
      async close() {
        await driver.close()
        if (deleteSqlDatabase != null) await deleteSqlDatabase(name)
      }
    }
  } catch (error) {
    await driver.close().catch(() => undefined)
    if (deleteSqlDatabase != null) {
      await deleteSqlDatabase(name).catch(() => undefined)
    }
    throw new Error(`Cannot open a scratch database: ${String(error)}`)
  }
}
