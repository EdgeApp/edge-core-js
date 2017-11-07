import babel from 'rollup-plugin-babel'
import commonjs from 'rollup-plugin-commonjs'
import packageJson from './package.json'

const babelOpts = {
  presets: ['flow'],
  plugins: ['transform-object-rest-spread']
}

export default {
  external: [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies)
  ],
  input: 'src/indexABC.js',
  output: [{ file: packageJson['react-native'], format: 'es' }],
  plugins: [
    commonjs({
      include: 'build/crypto-bundle.js'
    }),
    babel(babelOpts)
  ],
  sourcemap: true
}
