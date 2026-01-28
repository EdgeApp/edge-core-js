import { makeContext, makeFakeWorld } from './core/core'
import { defaultOnLog, LogBackend } from './core/log/log'
import { makeBrowserIo } from './io/browser/browser-io'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeFakeWorldOptions
} from './types/types'

export { makeBrowserIo }
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
  const { crashReporter, onLog = defaultOnLog } = opts
  const logBackend: LogBackend = { crashReporter, onLog }
  return makeContext(
    { io: makeBrowserIo(logBackend), nativeIo: {} },
    logBackend,
    opts
  )
}

export function makeFakeEdgeWorld(
  users: EdgeFakeUser[] = [],
  opts: EdgeFakeWorldOptions = {}
): Promise<EdgeFakeWorld> {
  const { crashReporter, onLog = defaultOnLog } = opts
  const logBackend: LogBackend = { crashReporter, onLog }
  return Promise.resolve(
    makeFakeWorld(
      { io: makeBrowserIo(logBackend), nativeIo: {} },
      logBackend,
      users
    )
  )
}
