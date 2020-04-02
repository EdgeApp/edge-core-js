// @flow

import { afterEach } from 'mocha'

import {
  addEdgeCorePlugins,
  closeEdge,
  lockEdgeCorePlugins
} from '../src/index.js'
import { allPlugins } from './fake/fake-plugins.js'

afterEach(function () {
  closeEdge()
})

addEdgeCorePlugins(allPlugins)
lockEdgeCorePlugins()
