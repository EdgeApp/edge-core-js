import babel from 'rollup-plugin-babel'
import multiEntry from 'rollup-plugin-multi-entry'

import config from '../rollup.config.js'

const aliasPlugin = config[0].plugins[0]

export default {
  external: config[0].external,
  input: 'test/**/*.test.js',
  output: [{ file: 'build/tests.js', format: 'cjs', sourcemap: true }],
  plugins: [aliasPlugin, babel(), multiEntry()]
}
