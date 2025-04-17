const { exec } = require('child_process')
const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
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
  presets: [
    ['@babel/preset-env', { targets: { chrome: '55' } }],
    '@babel/preset-typescript',
    '@babel/preset-react'
  ],
  plugins: [
    '@babel/plugin-transform-runtime',
    'babel-plugin-transform-fake-error-class'
  ],
  cacheDirectory: true
}

module.exports = {
  devtool: debug ? 'source-map' : undefined,
  devServer: {
    allowedHosts: 'all',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        'X-Requested-With, content-type, Authorization',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    hot: false,
    static: bundlePath,
    // Proxy /plugin/ requests to BundleHTTPServer since plugins are in the app bundle
    proxy: [
      {
        context: ['/plugin'],
        target: 'http://localhost:3693',
        changeOrigin: true
      }
    ]
  },
  entry: './src/io/react-native/react-native-worker.ts',
  experiments: {
    asyncWebAssembly: true
  },
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
      },
      {
        test: /\.wasm$/,
        type: 'webassembly/async'
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
    new webpack.ProvidePlugin({ process: ['process'] }),
    // Copy static files and mix-fetch WASM/worker files
    new CopyPlugin({
      patterns: [
        // HTML entry point
        {
          from: path.resolve(__dirname, 'src/index.html'),
          to: 'index.html'
        },
        // mix-fetch WASM files for NYM mixnet support
        {
          from: path.resolve(
            __dirname,
            'node_modules/@nymproject/mix-fetch/*.wasm'
          ),
          to: '[name][ext]'
        },
        // mix-fetch web worker files
        {
          from: path.resolve(
            __dirname,
            'node_modules/@nymproject/mix-fetch/web-worker-*.js'
          ),
          to: '[name][ext]'
        }
      ]
    })
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
