import multiEntry from 'rollup-plugin-multi-entry'

import packageJson from '../package.json'
import config from '../rollup.config.js'

export default {
  external: [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies),
    'regenerator-runtime/runtime'
  ],
  input: 'test/**/*.test.js',
  output: [{ file: 'build/tests.js', format: 'cjs' }],
  plugins: [...config[0].plugins, multiEntry()],
  sourcemap: true
}
