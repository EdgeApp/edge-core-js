#!/usr/bin/env node

const { makeNodeDisklet } = require('disklet')
const eslint = require('eslint')
const path = require('path')
const { promisify } = require('util')
const webpack = require('webpack')

function jsToTs(code) {
  const output = code
    // Change `+x` to `readonly x`:
    .replace(/(\n *)\+(\[?[_a-zA-Z0-9]+)/g, '$1readonly $2')
    // Fix differently-named types:
    .replace(/\bmixed\b/g, 'unknown')
    .replace(/\| void\b/g, '| undefined')
    .replace(/: void\b/g, ': undefined')
    .replace(/\$Shape</g, 'Partial<')
    // Fix `import type` syntax:
    .replace(/\bimport type\b/g, 'import')
    .replace(/\btype ([_a-zA-Z0-9]+)( *[,\n}])/g, '$1$2')
    // We aren't JS anymore:
    .replace(/\/\/ @flow/, '')
    .replace(/'(\.[^']*)\.js'/, "'$1'")

  return output
}

const files = [
  { js: 'src/types/error.js', ts: 'lib/types/error.ts' },
  { js: 'src/types/exports.js', ts: 'lib/types/exports.ts' },
  { js: 'src/types/types.js', ts: 'lib/types/types.ts' },
  { js: 'src/types/server-types.js', ts: 'lib/types/server-types.ts' },
  { js: 'src/types/server-cleaners.js', ts: 'lib/types/server-cleaners.ts' }
]

async function main() {
  const disklet = makeNodeDisklet('.')
  await disklet.setText(
    'lib/types/index.ts',
    "export * from './types'\n" + "export * from './exports'\n"
  )

  // Transpile error classes to plain Javascript for use by core plugins:
  await promisify(webpack)({
    entry: './src/types/types.js',
    externals: ['cleaners', 'rfc4648'],
    mode: 'production',
    module: {
      rules: [
        {
          test: /\.js$/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-flow'],
              plugins: ['babel-plugin-transform-fake-error-class']
            }
          }
        }
      ]
    },
    optimization: { minimize: false },
    output: {
      filename: 'types.js',
      libraryTarget: 'commonjs',
      path: path.resolve(__dirname)
    }
  })

  // Transpile Flow types to Typescript:
  for (const file of files) {
    const js = await disklet.getText(file.js, 'utf8')
    await disklet.setText(file.ts, jsToTs(js))
  }

  // Fix the Typescript files with ESLint:
  const cli = new eslint.CLIEngine({ fix: true, ignore: false })
  const report = cli.executeOnFiles(['./lib/types/*.ts'])
  eslint.CLIEngine.outputFixes(report)
  if (eslint.CLIEngine.getErrorResults(report.results).length > 0) {
    throw new Error(
      'Conversion to TypeScript failed. Please run `npx eslint --no-ignore lib/types/*.ts` to see errors.'
    )
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
