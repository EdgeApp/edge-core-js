// @flow

import { addEdgeCorePlugins } from './plugins/plugins-actions.js'
import { makeChangellyPlugin } from './swap/changelly-plugin.js'
import { makeChangeNowPlugin } from './swap/changenow-plugin.js'
import { makeFaastPlugin } from './swap/faast-plugin.js'
import { makeShapeshiftPlugin } from './swap/shapeshift-plugin.js'

export { makeFakeIo } from './fake/fake-io.js'
export { makeFakeWorld } from './fake/fake-world.js'
export {
  addEdgeCorePlugins,
  lockEdgeCorePlugins
} from './plugins/plugins-actions.js'
export { closeEdge, makeContext } from './root.js'

addEdgeCorePlugins({
  changelly: makeChangellyPlugin,
  changenow: makeChangeNowPlugin,
  faast: makeFaastPlugin,
  shapeshift: makeShapeshiftPlugin
})
