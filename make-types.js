const fs = require('fs')

const { transform } = require('sucrase')

const code = fs.readFileSync('src/types/error.js', 'utf8')
const output = transform(code, { transforms: ['flow', 'imports'] }).code
fs.writeFileSync('types.js', output)
