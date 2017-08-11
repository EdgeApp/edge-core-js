import buble from 'rollup-plugin-buble'
import commonjs from 'rollup-plugin-commonjs'
import packageJson from './package.json'

export default {
  entry: 'src/index.js',
  external: Object.keys(packageJson.dependencies),
  plugins: [
    buble({
      objectAssign: 'Object.assign',
      transforms: {
        dangerousForOf: true
      }
    }),
    commonjs({
      include: 'build/crypto-bundle.js'
    })
  ],
  targets: [
    {
      dest: packageJson.main,
      format: 'cjs',
      sourceMap: true
    },
    {
      dest: packageJson.module,
      format: 'es',
      sourceMap: true
    }
  ]
}
