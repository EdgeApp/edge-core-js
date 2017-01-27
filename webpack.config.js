module.exports = {
  entry: './src/crypto/bundle.js',
  externals: ['buffer'],
  module: {
    loaders: [
      { test: /\.json$/, loader: 'json-loader' }
    ]
  },
  output: {
    filename: './dist/crypto-bundle.js',
    libraryTarget: 'commonjs'
  }
}
