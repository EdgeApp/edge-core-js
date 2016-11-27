module.exports = {
  entry: './src/abc.js',
  module: {
    loaders: [
      { test: /\.json$/, loader: 'json-loader' }
    ]
  },
  output: {
    filename: 'abc.js',
    // Export the library as a global var:
    libraryTarget: "commonjs",
    // Name of the global var:
    library: "abc"
  }
}
