module.exports = {
  entry: './src/abc-web.js',
  output: {
    filename: 'abc.js',
    // Export the library as a global var:
    libraryTarget: "var",
    // Name of the global var:
    library: "abc"
  }
}
