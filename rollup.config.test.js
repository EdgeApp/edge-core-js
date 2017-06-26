import config from './rollup.config.js'

export default {
  entry: 'test/all.js',
  external: ['assert', ...config.external],
  plugins: config.plugins,
  targets: [
    {
      dest: 'build/tests.cjs.js',
      format: 'cjs',
      sourceMap: true
    }
  ]
}
