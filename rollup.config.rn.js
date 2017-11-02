import babel from 'rollup-plugin-babel'
import commonjs from 'rollup-plugin-commonjs'
import packageJson from './package.json'

const babelOpts = {
  presets: ['flow'],
  plugins: ['transform-object-rest-spread']
}

export default {
  entry: 'src/indexABC.js',
  external: [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies)
  ],
  plugins: [
    commonjs({
      include: 'build/crypto-bundle.js'
    }),
    babel(babelOpts)
  ],
  targets: [
    {
      dest: packageJson['react-native'],
      format: 'es',
      sourceMap: true
    }
  ]
}
