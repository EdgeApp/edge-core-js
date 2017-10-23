import multiEntry from 'rollup-plugin-multi-entry'
import config from './rollup.config.js'

export default {
  entry: 'src/**/*.test.js',
  external: config.external,
  plugins: [multiEntry(), ...config.plugins],
  targets: [
    {
      dest: 'build/tests.cjs.js',
      format: 'cjs',
      sourceMap: true
    }
  ]
}
