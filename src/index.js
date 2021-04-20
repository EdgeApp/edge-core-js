// @flow

import { makeLocalBridge } from 'yaob'

import { makeContext, makeFakeWorld } from './core/core.js'
import { defaultOnLog } from './core/log/log.js'
import { makeNodeIo } from './io/node/node-io.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFakeWorldOptions
} from './types/types.js'

export { makeNodeIo }
export {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins,
  makeFakeIo
} from './core/core.js'
export * from './types/types.js'

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
      { cloneMessage: message => JSON.parse(JSON.stringify(message)) }
    )
  )
}
