#!/usr/bin/env node

const babel = require('@babel/core')
const { makeNodeDisklet } = require('disklet')
const eslint = require('eslint')

function jsToTs(code) {
  const output = code
    // Change `+x` to `readonly x`:
    .replace(/(\n *)\+(\[?[_a-zA-Z]+)/g, '$1readonly $2')
    // Fix differently-named types:
    .replace(/\bmixed\b/g, 'unknown')
    .replace(/\| void\b/g, '| undefined')
    // Fix `import type` syntax:
    .replace(/\bimport type\b/g, 'import')
    .replace(/\btype ([_a-zA-Z]+)( *[,\n}])/g, '$1$2')
    // We aren't JS anymore:
    .replace(/\/\/ @flow/, '')
    .replace(/'(\.[^']*)\.js'/, "'$1'")

  return output
}

async function main() {
  const disklet = makeNodeDisklet('.')
  await disklet.setText(
    'lib/types/index.ts',
    "export * from './types'\n" + "export * from './exports'\n"
  )

  // Transpile errors to plain Javascript and TypeScript:
  const errorFile = await disklet.getText('src/types/error.js', 'utf8')
  const errorJs = babel.transformSync(errorFile, {
    presets: ['@babel/preset-flow'],
    plugins: [
      '@babel/plugin-transform-modules-commonjs',
      'babel-plugin-transform-fake-error-class'
    ]
  }).code
  await disklet.setText('types.js', errorJs)
  await disklet.setText('lib/types/error.ts', jsToTs(errorFile))

  // Transpile entry functions to Typescript:
  const exportsFile = await disklet.getText('src/types/exports.js', 'utf8')
  await disklet.setText('lib/types/exports.ts', jsToTs(exportsFile))

  // Transpile Flow types to Typescript:
  const typesFile = await disklet.getText('src/types/types.js', 'utf8')
  await disklet.setText('lib/types/types.ts', jsToTs(typesFile))

  // Fix the files with ESLint:
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
