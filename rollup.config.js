import babel from 'rollup-plugin-babel'
import commonjs from 'rollup-plugin-commonjs'
import packageJson from './package.json'

const babelOpts = {
  presets: ['es2015-rollup', 'flow'],
  plugins: [
    'transform-object-rest-spread',
    ['fast-async', { compiler: { promises: true, noRuntime: true } }]
  ]
}

export default {
  external: [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies)
  ],
  input: 'src/indexABC.js',
  output: [
    { file: packageJson.main, format: 'cjs' },
    { file: packageJson.module, format: 'es' }
  ],
  plugins: [
    commonjs({
      include: 'build/crypto-bundle.js'
    }),
    babel(babelOpts)
  ],
  sourcemap: true
}
