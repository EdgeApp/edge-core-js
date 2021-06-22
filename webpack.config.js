const path = require('path')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')

// Set this to false for easier debugging:
const production = true

const babelOptions = {
  presets: production
    ? ['@babel/preset-env', '@babel/preset-flow', '@babel/preset-react']
    : ['@babel/preset-flow', '@babel/preset-react'],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    '@babel/plugin-proposal-nullish-coalescing-operator',
    '@babel/plugin-proposal-optional-chaining',
    '@babel/plugin-transform-runtime',
    'babel-plugin-transform-fake-error-class'
  ],
  cacheDirectory: true
}

module.exports = {
  devtool: 'source-map',
  entry: './src/io/react-native/react-native-worker.js',
  mode: production ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: { loader: 'babel-loader', options: babelOptions }
      }
    ]
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          safari10: true
        }
      })
    ]
  },

  output: {
    filename: 'lib/react-native/edge-core.js',
    path: path.resolve(__dirname)
  },
  plugins: [
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
    new webpack.ProvidePlugin({ process: ['process'] })
  ],
  performance: { hints: false },
  resolve: {
    fallback: {
      assert: require.resolve('assert/'),
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify')
    }
  },
  target: ['web', 'es5']
}
