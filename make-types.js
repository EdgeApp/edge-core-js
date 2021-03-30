#!/usr/bin/env node

const { babel } = require('@rollup/plugin-babel')
const { makeNodeDisklet } = require('disklet')
const eslint = require('eslint')
const { rollup } = require('rollup')

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
  const bundle = await rollup({
    external: ['cleaners', 'rfc4648'],
    input: './src/types/types.js',
    plugins: [
      babel({
        babelHelpers: 'bundled',
        babelrc: false,
        plugins: ['babel-plugin-transform-fake-error-class'],
        presets: ['@babel/preset-flow']
      })
    ]
  })
  await bundle.write({
    file: './types.js',
    format: 'cjs'
  })
  await bundle.close()

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
