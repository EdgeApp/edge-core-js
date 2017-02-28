import buble from 'rollup-plugin-buble'
import commonjs from 'rollup-plugin-commonjs'
const packageJson = require('./package.json')

export default {
  entry: 'src/abc.js',
  external: [
    'assert',
    'path',
    'crypto',
    'buffer',
    'fs',
    'url'
  ].concat(Object.keys(packageJson.dependencies)),
  plugins: [
    buble({
      transforms: {
        dangerousForOf: true
      }
    }),
    commonjs({
      include: 'dist/crypto-bundle.js'
    })
  ],
  targets: [
    {
      dest: packageJson['main'],
      format: 'cjs',
      sourceMap: true
    }, {
      dest: packageJson['module'],
      format: 'es',
      sourceMap: true
    }
  ]
}
