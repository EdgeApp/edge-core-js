import config from './rollup.config.js'

config.entry = 'test/all.js'
config.targets = [
  {
    dest: 'dist/tests.cjs.js',
    format: 'cjs',
    sourceMap: true
  }
]

export default config
