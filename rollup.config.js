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
