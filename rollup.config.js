import babel from '@rollup/plugin-babel'
import flowEntry from 'rollup-plugin-flow-entry'
import mjs from 'rollup-plugin-mjs-entry'

import packageJson from './package.json'

const babelOpts = {
  babelHelpers: 'bundled',
  babelrc: false,
  plugins: ['babel-plugin-transform-fake-error-class'],
  presets: ['@babel/preset-flow', '@babel/preset-react']
}
const external = ['crypto', ...Object.keys(packageJson.dependencies)]

// Produces the Node entry point and standalone type definition files.
export default [
  {
    external,
    input: './src/index.js',
    output: { file: packageJson.main, format: 'cjs' },
    plugins: [
      babel(babelOpts),
      flowEntry({ types: './src/types/exports.js' }),
      mjs()
    ]
  },
  {
    external,
    input: './src/types/types.js',
    output: { file: './types.js', format: 'cjs' },
    plugins: [babel(babelOpts), flowEntry(), mjs()]
  }
]
