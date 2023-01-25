import { afterEach } from 'mocha'

import {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins
} from '../src/index'
import { allPlugins } from './fake/fake-plugins'

afterEach(function () {
  closeEdge()
})

addEdgeCorePlugins(allPlugins)
lockEdgeCorePlugins()
