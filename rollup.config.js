import alias from 'rollup-plugin-alias'
import babel from 'rollup-plugin-babel'
import commonjs from 'rollup-plugin-commonjs'

import packageJson from './package.json'

const babelOpts = {
  presets: ['es2015-rollup', 'flow'],
  plugins: [
    'transform-async-to-generator',
    ['transform-es2015-for-of', { loose: true }],
    'transform-object-rest-spread',
    'transform-regenerator'
  ]
}

const commonjsOpts = {
  include: 'build/crypto-bundle.js'
}

const external = [
  'regenerator-runtime/runtime',
  ...Object.keys(packageJson.dependencies),
  ...Object.keys(packageJson.devDependencies)
]

export default [
  {
    external,
    input: 'src/edge-core-index.js',
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
      babel(babelOpts)
    ],
    sourcemap: true
  },
  {
    external,
    input: 'src/edge-core-index.js',
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
