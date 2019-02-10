const path = require('path')

const babelOptions = {
  // For debugging, just remove "@babel/preset-env":
  presets: ['@babel/preset-env', '@babel/preset-flow', '@babel/preset-react'],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    '@babel/plugin-transform-runtime'
  ],
  cacheDirectory: true
}

module.exports = {
  devtool: 'source-map',
  entry: './src/io/react-native/react-native-worker.js',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: { loader: 'babel-loader', options: babelOptions }
      }
    ]
  },
  output: {
    filename: 'lib/react-native/edge-core.js',
    path: path.resolve(__dirname)
  }
}
