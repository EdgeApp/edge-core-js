import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import flowEntry from 'rollup-plugin-flow-entry'
import mjs from 'rollup-plugin-mjs-entry'

import packageJson from './package.json'

const extensions = ['.ts']

const babelOpts = {
  babelHelpers: 'bundled',
  babelrc: false,
  extensions,
  plugins: ['babel-plugin-transform-fake-error-class'],
  presets: ['@babel/preset-typescript', '@babel/preset-react']
}

const external = ['crypto', ...Object.keys(packageJson.dependencies)]

const resolveOpts = { extensions }

// Produces the Node entry point and standalone type definition files.
export default [
  {
    external,
    input: './src/index.ts',
    output: { file: packageJson.main, format: 'cjs' },
    plugins: [
      resolve(resolveOpts),
      babel(babelOpts),
      flowEntry({ types: './lib/flow/exports.js' }),
      mjs(),
      json()
    ]
  },
  {
    external,
    input: './src/types/types.ts',
    output: { file: './types.js', format: 'cjs' },
    plugins: [
      resolve(resolveOpts),
      babel(babelOpts),
      flowEntry({ types: './lib/flow/types.js' }),
      mjs(),
      json()
    ]
  }
]
