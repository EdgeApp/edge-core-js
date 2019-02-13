const path = require('path')

const packageJson = require('./package.json')

const bundledModules = [
  'elliptic',
  'ethereumjs-tx',
  'ethereumjs-util',
  'hash.js',
  'hmac-drbg'
]

const externals = [
  ...Object.keys(packageJson.dependencies).filter(
    name => bundledModules.indexOf(name) < 0
  ),
  '@babel/runtime/regenerator',
  'react-native',
  'react-native-fast-crypto',
  'react-native-tcp',
  'react-native-tcp/tls'
]

module.exports = {
  devtool: 'source-map',
  entry: './src/react-native.js',
  externals,
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: '@sucrase/webpack-loader',
          options: { transforms: ['flow'] }
        }
      }
    ]
  },
  output: {
    filename: packageJson['react-native'],
    libraryTarget: 'commonjs',
    path: path.resolve(__dirname)
  }
}
