module.exports = {
  entry: './dist/abc.cjs.js',
  module: {
    loaders: [
      { test: /\.json$/, loader: 'json-loader' }
    ]
  },
  output: {
    filename: './dist/abc.webpack.js',
    libraryTarget: 'commonjs',
    library: 'abc'
  }
}
