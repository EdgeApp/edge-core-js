import eslint from 'rollup-plugin-eslint'
import config from './rollup.config.js'

export default {
  entry: 'test/all.js',
  external: ['assert', ...config.external],
  plugins: [
    eslint({
      exclude: 'build/crypto-bundle.js'
    }),
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
