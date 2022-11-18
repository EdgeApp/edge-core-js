// Run as `node -r sucrase/register scripts/make-types.js`

import { makeNodeDisklet } from 'disklet'
import eslint from 'eslint'

function jsToTs(code) {
  const output = code
    // Change `+x` to `readonly x`:
    .replace(/(\n *)\+(\[?[_a-zA-Z0-9]+)/g, '$1readonly $2')

    // Fix differently-named types:
    .replace(/\bdeclare export var\b/g, 'export declare const')
    .replace(/\bdeclare export\b/g, 'export declare')
    .replace(/\bmixed\b/g, 'unknown')
    .replace(/\| void\b/g, '| undefined')
    .replace(/: void\b/g, ': undefined')
    .replace(
      /\bReact\$StatelessFunctionalComponent<(\w+)>/g,
      '(props: $1) => any'
    )

    // Fix `import type` syntax:
    .replace(/\bimport type\b/g, 'import')
    .replace(/\btype ([_a-zA-Z0-9]+)( *[,\n}])/g, '$1$2')

    // We aren't JS anymore:
    .replace(/\/\/ @flow/, '')
    .replace(/'(\.[^']*)\.js'/, "'$1'")

    // Delete shims:
    .replace(/.*\/\/ @ts-delete/g, '')

  return output
}

const files = [
  { js: 'src/types/error.js', ts: 'lib/types/error.ts' },
  { js: 'src/types/exports.js', ts: 'lib/types/exports.ts' },
  { js: 'src/types/fake-types.js', ts: 'lib/types/fake-types.ts' },
  { js: 'src/types/server-cleaners.js', ts: 'lib/types/server-cleaners.ts' },
  { js: 'src/types/server-types.js', ts: 'lib/types/server-types.ts' },
  { js: 'src/types/type-helpers.js', ts: 'lib/types/type-helpers.ts' },
  { js: 'src/types/types.js', ts: 'lib/types/types.ts' }
]

async function main() {
  const disklet = makeNodeDisklet('.')

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

  // Create an entry file for `edge-core-js/types`:
  await disklet.setText('types.d.ts', "export * from './lib/types';\n")
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
