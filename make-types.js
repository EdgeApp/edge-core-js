#!/usr/bin/env node

const babel = require('@babel/core')
const fs = require('fs')

// Transpile errors to plain Javascript:
const errorFile = fs.readFileSync('src/types/error.js', 'utf8')
const errorJs = babel.transformSync(errorFile, {
  presets: ['@babel/preset-flow'],
  plugins: [
    '@babel/plugin-transform-modules-commonjs',
    'babel-plugin-transform-fake-error-class'
  ]
}).code
fs.writeFileSync('types.js', errorJs)
