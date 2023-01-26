const { exec } = require('child_process')
const path = require('path')
const TerserPlugin = require('terser-webpack-plugin')
const webpack = require('webpack')

// Use "yarn prepare.dev" to make a debug-friendly static build:
const debug =
  process.env.WEBPACK_SERVE || process.env.EDGE_MODE === 'development'

// Try exposing our socket to adb (errors are fine):
if (process.env.WEBPACK_SERVE) {
  console.log('adb reverse tcp:8080 tcp:8080')
  exec('adb reverse tcp:8080 tcp:8080', () => {})
}

const bundlePath = path.resolve(
  __dirname,
  'android/src/main/assets/edge-core-js'
)

const babelOptions = {
  presets: debug
    ? ['@babel/preset-typescript', '@babel/preset-react']
    : ['@babel/preset-env', '@babel/preset-typescript', '@babel/preset-react'],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    '@babel/plugin-transform-runtime',
    'babel-plugin-transform-fake-error-class'
  ],
  cacheDirectory: true
}

module.exports = {
  devtool: debug ? 'source-map' : undefined,
  devServer: {
    allowedHosts: 'all',
    hot: false,
    static: bundlePath
  },
  entry: './src/io/react-native/react-native-worker.ts',
  mode: debug ? 'development' : 'production',
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: debug
          ? {
              loader: '@sucrase/webpack-loader',
              options: { transforms: ['typescript'] }
            }
          : {
              loader: 'babel-loader',
              options: babelOptions
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
    minimizer: [new TerserPlugin({ terserOptions: { safari10: true } })]
  },
  output: {
    filename: 'edge-core.js',
    path: bundlePath
  },
  plugins: [
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
    new webpack.ProvidePlugin({ process: ['process'] })
  ],
  performance: { hints: false },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      assert: require.resolve('assert/'),
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify')
    }
  },
  target: ['web', 'es5']
}
