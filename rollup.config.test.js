import multiEntry from 'rollup-plugin-multi-entry'

import config from './rollup.config.js'

export default {
  external: [...config[0].external, 'assert'],
  input: 'src/**/*.test.js',
  output: [{ file: 'build/tests.cjs.js', format: 'cjs' }],
  plugins: [...config[0].plugins, multiEntry()],
  sourcemap: true
}
