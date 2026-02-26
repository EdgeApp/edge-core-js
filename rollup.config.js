import babel from '@rollup/plugin-babel'
import resolve from '@rollup/plugin-node-resolve'
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
    plugins: [resolve(resolveOpts), babel(babelOpts), mjs()]
  },
  {
    external,
    input: './src/types/types.ts',
    output: { file: './types.js', format: 'cjs' },
    plugins: [resolve(resolveOpts), babel(babelOpts), mjs()]
  }
]
