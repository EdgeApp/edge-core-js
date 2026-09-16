import { makeLocalBridge } from 'yaob'

import { makeContext, makeFakeWorld } from './core/core'
import { prepareDatabase } from './core/db/db-open'
import { ensureWalletPrefix } from './core/db/plugin-tables'
import { makeTxDatabase } from './core/db/tx-database-api'
import { defaultOnLog } from './core/log/log'
import { hideProperties } from './io/hidden-properties'
import { makeNodeIo } from './io/node/node-io'
import {
  makeMemorySqlDriver,
  makeMemorySqlDriverFactory
} from './io/node/node-sql-driver'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeFakeWorldOptions,
  EdgeTxDatabase
} from './types/types'

export { makeNodeIo }
export {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins,
  makeFakeIo
} from './core/core'
export * from './types/types'

export function makeEdgeContext(
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const { crashReporter, onLog = defaultOnLog, path = './edge' } = opts
  return makeContext(
    { io: makeNodeIo(path), nativeIo: {} },
    { crashReporter, onLog },
    opts
  )
}

export function makeFakeEdgeWorld(
  users: EdgeFakeUser[] = [],
  opts: EdgeFakeWorldOptions = {}
): Promise<EdgeFakeWorld> {
  const { crashReporter, onLog = defaultOnLog } = opts
  return Promise.resolve(
    makeLocalBridge(
      makeFakeWorld(
        {
          io: {
            ...makeNodeIo('.'),
            // A fake world keeps its databases in memory, as it does its
            // disklet. Otherwise a test run would leave real database files
            // beside whatever directory it happened to start in.
            ...makeMemorySqlDriverFactory()
          },
          nativeIo: {}
        },
        { crashReporter, onLog },
        users
      ),
      {
        cloneMessage: message => JSON.parse(JSON.stringify(message)),
        hideProperties
      }
    )
  )
}

/**
 * A transaction database backed by memory, for testing a plugin.
 *
 * A plugin moving onto `EdgeTxDatabase` has to be able to test against the
 * real thing -- the same schema, the same triggers, the same authorizer --
 * without standing up an account. This is that, and it is the reason it is
 * exported rather than kept internal.
 *
 * Node only, and unencrypted, because an in-memory database has nothing at
 * rest to protect.
 */
export async function makeMemoryTxDatabase(opts: {
  walletId: string
  pluginId: string
}): Promise<EdgeTxDatabase> {
  const { walletId, pluginId } = opts
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  const prefix = await ensureWalletPrefix(driver, walletId, pluginId)
  return makeTxDatabase({ driver, walletId, pluginId, prefix })
}
