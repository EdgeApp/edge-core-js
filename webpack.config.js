const path = require('path')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')

// Use "yarn prepare.dev" to make a debug-friendly build:
const production = process.env.EDGE_MODE !== 'development'

module.exports = {
  devtool: 'source-map',
  entry: './src/io/react-native/react-native-worker.js',
  mode: production ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: production
          ? {
              loader: 'babel-loader',
              options: {
                presets: ['@babel/preset-env', '@babel/preset-flow'],
                plugins: [
                  ['@babel/plugin-transform-for-of', { assumeArray: true }],
                  '@babel/plugin-transform-runtime',
                  'babel-plugin-transform-fake-error-class'
                ],
                cacheDirectory: true
              }
            }
          : {
              loader: '@sucrase/webpack-loader',
              options: { transforms: ['flow'] }
            }
      },
      {
        include: path.resolve(__dirname, 'node_modules/buffer/index.js'),
        use: {
          loader: 'babel-loader',
          options: { presets: ['@babel/preset-env'] }
        }
      }
    ]
  },
  optimization: {
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
