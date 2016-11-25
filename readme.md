# Airbitz Javascript core

Run `npm install` to get the dependencies you need,
then run `npm test` to run the tests.

To build for the web, run `npm run webpack`.
This will produce a file, `./abc.js`, which can be used in a `<script>` tag.

All sources are in the [JavaScript Standard Style](http://standardjs.com/).


## REACT NATIVE
change webpack.config.js
```
module.exports = {
  entry: './src/abc.js',
  module: {
    loaders: [
    // note the change from json to json-loader here, it might be something you need to do for anything to actually build
      { test: /\.json$/, loader: 'json-loader' }
    ]
  },
  output: {
    filename: 'abc.js',
    // Export the library as a global var:
    // libraryTarget: "var",
    // NO Don't do that for REACT NATIVE. set it as commonjs
    libraryTarget: "commonjs",
    // Name of the global var:
    library: "abc"
  }
}
```