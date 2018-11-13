import multiEntry from 'rollup-plugin-multi-entry'

import packageJson from '../package.json'
import config from '../rollup.config.js'

export default {
  external: [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies),
    '@babel/runtime/regenerator'
  ],
  input: 'test/**/*.test.js',
  output: [{ file: 'build/tests.js', format: 'cjs', sourcemap: true }],
  plugins: [...config[0].plugins, multiEntry()]
}
