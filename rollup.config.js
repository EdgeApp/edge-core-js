import buble from 'rollup-plugin-buble'
const packageJson = require('./package.json')

export default {
  entry: 'src/abc.js',
  external: [
    'assert',
    'url'
  ].concat(Object.keys(packageJson.dependencies)),
  plugins: [
    buble({
      transforms: {
        dangerousForOf: true
      }
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
