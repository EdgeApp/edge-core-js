#!/usr/bin/env node

const babel = require('@babel/core')
const fs = require('fs')
const eslint = require('eslint')

function jsToTs(code) {
  const output = code
    // Change `+x` to `readonly x`:
    .replace(/(\n *)\+([_a-zA-Z]+)/g, '$1readonly $2')
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

// Transpile errors to plain Javascript and TypeScript:
const errorFile = fs.readFileSync('src/types/error.js', 'utf8')
const errorJs = babel.transformSync(errorFile, {
  presets: ['@babel/preset-flow'],
  plugins: [
    '@babel/plugin-transform-modules-commonjs',
    'babel-plugin-transform-fake-error-class'
  ]
}).code
fs.writeFileSync('types.js', errorJs)
fs.writeFileSync('src/types/error.ts', jsToTs(errorFile))

// Transpile Flow types to Typescript:
const typesFile = fs.readFileSync('src/types/types.js', 'utf8')
fs.writeFileSync('src/types/types.ts', jsToTs(typesFile))

// Fix the files with ESLint:
const cli = new eslint.CLIEngine({ fix: true, ignore: false })
const report = cli.executeOnFiles(['./src/types/*.ts'])
eslint.CLIEngine.outputFixes(report)
if (eslint.CLIEngine.getErrorResults(report.results).length > 0) {
  console.error(
    'Error: Conversion to TypeScript failed. Please run `yarn lint` to see errors.'
  )
  process.exit(1)
}
