// @flow

import { addEdgeCorePlugins } from './plugins/plugins-actions.js'
import { changellyPlugin } from './swap/changelly-plugin.js'
import { changenowPlugin } from './swap/changenow-plugin'
import { faastPlugin } from './swap/faast-plugin.js'
import { shapeshiftPlugin } from './swap/shapeshift-plugin.js'

export { makeFakeIo } from './fake/fake-io.js'
export { makeFakeWorld } from './fake/fake-world.js'
export {
  addEdgeCorePlugins,
  lockEdgeCorePlugins
} from './plugins/plugins-actions.js'
export { closeEdge, makeContext } from './root.js'

addEdgeCorePlugins({
  changelly: changellyPlugin,
  changenow: changenowPlugin,
  faast: faastPlugin,
  shapeshift: shapeshiftPlugin
})
