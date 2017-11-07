import multiEntry from 'rollup-plugin-multi-entry'
import config from './rollup.config.js'

export default {
  external: config.external,
  input: 'src/**/*.test.js',
  output: [{ file: 'build/tests.cjs.js', format: 'cjs' }],
  plugins: [multiEntry(), ...config.plugins],
  sourcemap: true
}
