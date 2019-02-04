import alias from 'rollup-plugin-alias'
import babel from 'rollup-plugin-babel'
import flowEntry from 'rollup-plugin-flow-entry'

import packageJson from './package.json'

const external = [
  ...Object.keys(packageJson.dependencies),
  ...Object.keys(packageJson.devDependencies),
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
        './io/react-native/react-native-io.js':
          'src/io/react-native/react-native-dummy.js'
      }),
      babel(),
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
      alias({ './io/node/node-io.js': 'src/io/node/node-dummy.js' }),
      babel()
    ]
  },
  // Client-side methods:
  {
    external: ['yaob'],
    input: 'src/client-side.js',
    output: { file: 'lib/client-side.js', format: 'es', sourcemap: true },
    plugins: [babel()]
  }
]
