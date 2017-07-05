import eslint from 'rollup-plugin-eslint'
import multiEntry from 'rollup-plugin-multi-entry'
import config from './rollup.config.js'

export default {
  entry: 'src/**/*.test.js',
  external: ['assert', ...config.external],
  plugins: [
    eslint({
      exclude: 'build/crypto-bundle.js'
    }),
    multiEntry(),
    ...config.plugins
  ],
  targets: [
    {
      dest: 'build/tests.cjs.js',
      format: 'cjs',
      sourceMap: true
    }
  ]
}
