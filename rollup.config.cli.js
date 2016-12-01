import config from './rollup.config.js'
const packageJson = require('./package.json')

config.banner = '#!/usr/bin/env node'
config.entry = 'cli/index.js',
config.targets = [
  {
    dest: packageJson['bin'],
    format: 'cjs',
    sourceMap: true
  }
]

export default config
