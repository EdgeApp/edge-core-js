module.exports = {
  entry: './src/crypto/bundle.js',
  externals: ['buffer'],
  module: {
    loaders: [{ test: /\.json$/, loader: 'json-loader' }]
  },
  output: {
    filename: './build/crypto-bundle.js',
    libraryTarget: 'commonjs'
  }
}
