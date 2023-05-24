// Run as `node -r sucrase/register scripts/make-types.ts`

import { makeNodeDisklet } from 'disklet'
import prettier from 'prettier'

function tsToFlow(code: string): string {
  // First, use Prettier to add semicolons everywhere:
  const formatted = prettier.format(code, {
    parser: 'typescript',
    semi: true
  })

  const fixed = formatted
    // Language differences:
    .replace(/\breadonly /g, '+')
    .replace(/\bexport declare const\b/g, 'declare export var')
    .replace(/\bexport declare\b/g, 'declare export')
    .replace(/\binterface (\w+) {/g, 'type $1 = {')
    .replace(/\binterface (\w+)<([^>]+)> {/g, 'type $1<$2> = {')
    .replace(/\binterface (\w+) extends (\w+) {/g, 'type $1 = {\n  ...$2;')
    .replace(/\bunknown\b/g, 'mixed')
    .replace(/\| undefined\b/g, '| void')
    .replace(/: undefined\b/g, ': void')

    // Builtin types:
    .replace(/\b(\w+): ComponentType</g, '$1: React$ComponentType<')
    .replace(/\bPartial<(\w+)>/g, '$Rest<$1, { ... }>')
    .replace(/\bAsyncIterableIterator\b/g, 'AsyncGenerator')

  return '// @flow\n\n' + fixed
}

async function main(): Promise<void> {
  const disklet = makeNodeDisklet('.')
  const listing = await disklet.list('src/types')
  const paths = Object.keys(listing).filter(name => listing[name] === 'file')

  // Transpile Flow types to Typescript:
  for (const path of paths) {
    const source = await disklet.getText(path)

    const flowPath = path
      .replace('src/types/', 'lib/flow/')
      .replace('.ts', '.js')
    const flowSource = tsToFlow(source)

    await disklet.setText(flowPath, flowSource)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
