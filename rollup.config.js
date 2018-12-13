import alias from 'rollup-plugin-alias'
import babel from 'rollup-plugin-babel'
import flowEntry from 'rollup-plugin-flow-entry'

import packageJson from './package.json'

const babelOpts = {
  babelrc: false,
  presets: ['@babel/preset-env', '@babel/preset-flow'],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    [
      '@babel/plugin-transform-runtime',
      { corejs: false, helpers: false, regenerator: true }
    ]
  ]
}

const external = [
  ...Object.keys(packageJson.dependencies),
  '@babel/runtime/regenerator',
  'react-native'
]

export default [
  // Normal build:
  {
    external,
    input: 'src/index.js',
    output: [
      { file: packageJson.main, format: 'cjs', sourcemap: true },
      { file: packageJson.module, format: 'es', sourcemap: true }
    ],
    plugins: [
      alias({
        './io/node/node-io.js': 'src/io/node/node-io.js',
        './io/react-native/react-native-io.js':
          'src/io/react-native/react-native-dummy.js'
      }),
      babel(babelOpts),
      flowEntry()
    ]
  },
  // React Native build:
  {
    external,
    input: 'src/index.js',
    output: {
      file: 'build/react-native.js',
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      alias({
        './io/node/node-io.js': 'src/io/node/node-dummy.js',
        './io/react-native/react-native-io.js':
          'src/io/react-native/react-native-io.js'
      }),
      babel(babelOpts)
    ]
  },
  // Client-side methods:
  {
    external: ['yaob'],
    input: 'src/client-side.js',
    output: { file: 'lib/client-side.js', format: 'es', sourcemap: true },
    plugins: [babel(babelOpts)]
  }
]
