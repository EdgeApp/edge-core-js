const path = require('path')

module.exports = {
  entry: './src/crypto/bundle.js',
  output: {
    filename: './build/crypto-bundle.js',
    libraryTarget: 'commonjs'
  },
  resolve: {
    alias: {
      buffer: path.join(__dirname, './src/crypto/empty.js')
    }
  }
}
