import alias from 'rollup-plugin-alias'
import babel from 'rollup-plugin-babel'
import commonjs from 'rollup-plugin-commonjs'
import flowEntry from 'rollup-plugin-flow-entry'

import packageJson from './package.json'

const babelOpts = {
  exclude: './build/crypto-bundle.js',
  presets: ['@babel/preset-env', '@babel/preset-flow'],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    [
      '@babel/plugin-transform-runtime',
      { corejs: false, helpers: false, regenerator: true }
    ]
  ]
}

const commonjsOpts = {
  include: 'build/crypto-bundle.js'
}

const external = [
  ...Object.keys(packageJson.dependencies),
  '@babel/runtime/regenerator',
  'react-native'
]

export default [
  {
    external,
    input: 'src/index.js',
    output: [
      { file: packageJson.main, format: 'cjs' },
      { file: packageJson.module, format: 'es' }
    ],
    plugins: [
      alias({
        './io/node/node-io.js': 'src/io/node/node-io.js',
        './io/react-native/react-native-io.js':
          'src/io/react-native/react-native-dummy.js'
      }),
      commonjs(commonjsOpts),
      babel(babelOpts),
      flowEntry()
    ],
    sourcemap: true
  },
  {
    external,
    input: 'src/index.js',
    output: { file: packageJson['react-native'], format: 'cjs' },
    plugins: [
      alias({
        './io/node/node-io.js': 'src/io/node/node-dummy.js',
        './io/react-native/react-native-io.js':
          'src/io/react-native/react-native-io.js'
      }),
      commonjs(commonjsOpts),
      babel(babelOpts)
    ],
    sourcemap: true
  }
]
