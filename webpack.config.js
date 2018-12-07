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
  entry: './build/react-native.js',
  externals,
  module: {
    rules: [
      {
        test: /\.js$/,
        use: ['source-map-loader'],
        enforce: 'pre'
      }
    ]
  },
  output: {
    filename: packageJson['react-native'],
    libraryTarget: 'commonjs'
  }
}
