import { asArray, asOptional, asString, asTuple, asValue } from 'cleaners'

import { makeRpcProtocol } from '../../util/json-rpc'

/**
 * A repo subscription, like `['GkVrxd1E...', '7:28']`.
 *
 * The repo ID is `base58(sha256(sha256(syncKey)))`, never the sync key.
 * The checkpoint is the newest entry of the repo's `lastHash`,
 * and is missing if the repo has never synced.
 */
export type SyncSubscribeParams =
  | [repoId: string]
  | [repoId: string, checkpoint: string]

/**
 * Cleans a subscription tuple, dropping a missing checkpoint,
 * so the wire form is `[repoId]` rather than `[repoId, null]`.
 */
const asSyncSubscribeParams = (raw: unknown): SyncSubscribeParams => {
  const [repoId, checkpoint] = asTuple(asString, asOptional(asString))(raw)
  return checkpoint == null ? [repoId] : [repoId, checkpoint]
}

/**
 * A repo change, carrying the server's new checkpoint.
 */
export type SyncUpdateParams = [repoId: string, checkpoint: string]

const asSyncUpdateParams = asTuple<SyncUpdateParams>(asString, asString)

const asSyncRepoIdParams = asTuple<[repoId: string]>(asString)

export type SyncSubscribeResult = ReturnType<typeof asSyncSubscribeResult>
const asSyncSubscribeResult = asValue(
  /** Subscribe failed; repo not subscribable */
  -1,
  /** Subscribe failed; the server could not check, so keep polling */
  0,
  /** Subscribe succeeded, no changes since the checkpoint */
  1,
  /** Subscribe succeeded, changes present, so pull now */
  2
)

/**
 * JSON-RPC 2.0 protocol for sync-server repo change notifications,
 * spoken over `/api/v2/ws`. The socket only reports that repos changed;
 * the changes themselves come over the REST API.
 */
export const syncProtocol = makeRpcProtocol({
  serverMethods: {
    subscribeRepos: {
      asParams: asArray(asSyncSubscribeParams),
      asResult: asArray(asSyncSubscribeResult)
    },

    unsubscribeRepos: {
      asParams: asArray(asSyncRepoIdParams),
      asResult: asValue(undefined, null)
    },

    ping: {
      asParams: asTuple(),
      asResult: asValue('pong')
    }
  },

  clientMethods: {
    update: {
      asParams: asArray(asSyncUpdateParams)
    },
    subLost: {
      asParams: asArray(asSyncRepoIdParams)
    }
  }
})
