import { makeContext, makeFakeWorld } from './core/core'
import { defaultOnLog } from './core/log/log'
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
  return makeContext(
    { io: makeBrowserIo(), nativeIo: {} },
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
    makeFakeWorld(
      { io: makeBrowserIo(), nativeIo: {} },
      { crashReporter, onLog },
      users
    )
  )
}
