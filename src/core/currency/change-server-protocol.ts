import {
  asArray,
  asObject,
  asOptional,
  asString,
  asTuple,
  asValue,
  Cleaner
} from 'cleaners'

import { makeRpcProtocol } from '../../util/json-rpc'

/**
 * A chain and address identifier, like `['bitcoin', '19z88q...']`
 */
export type SubscribeParams = [
  pluginId: string,
  address: string,

  /**
   * Block height or similar.
   * Might be missing the first time we scan an address.
   */
  checkpoint?: string
]

const asSubscribeParams = asTuple<SubscribeParams>(
  asString,
  asString,
  asOptional(asString)
)

export type SubscribeResult =
  /** Subscribe failed */
  | 0
  /** Subscribe succeeded, no changes */
  | 1
  /** Subscribed succeeded, changes present */
  | 2
// export type SubscribeResult = boolean

const asSubscribeResult: Cleaner<SubscribeResult> = asValue(0, 1, 2)
// const asSubscribeResult: Cleaner<SubscribeResult> = asBoolean

export const changeProtocol = makeRpcProtocol({
  serverMethods: {
    subscribe: {
      asParams: asArray(asSubscribeParams),
      asResult: asArray(asSubscribeResult)
    },

    unsubscribe: {
      asParams: asArray(asSubscribeParams),
      asResult: asValue(undefined)
    }
  },

  clientMethods: {
    update: {
      asParams: asSubscribeParams
    },
    pluginConnect: {
      asParams: asObject({ pluginId: asString })
    },
    pluginDisconnect: {
      asParams: asObject({ pluginId: asString })
    }
  }
})
