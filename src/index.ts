import { makeLocalBridge } from 'yaob'

import { makeContext, makeFakeWorld } from './core/core'
import { defaultOnLog } from './core/log/log'
import { hideProperties } from './io/hidden-properties'
import { makeNodeIo } from './io/node/node-io'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeFakeWorldOptions
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
        { io: makeNodeIo('.'), nativeIo: {} },
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
