module.exports = {
  entry: './src/abc.js',
  module: {
    loaders: [
      { test: /\.json$/, loader: 'json' }
    ]
  },
  output: {
    filename: 'abc.js',
    // Export the library as a global var:
    libraryTarget: "var",
    // Name of the global var:
    library: "abc"
  }
}
