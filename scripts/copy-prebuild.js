const { copyFileSync, mkdirSync } = require('fs')
const { dirname, join } = require('path')

/**
 * Files the built addon under the platform it was built for.
 *
 * `node-gyp` writes one path, `build/Release/edge_sql.node`, whatever it
 * built for -- so a tarball carrying it says nothing about which machine can
 * load it. A consumer on another platform would `require` a foreign binary,
 * and the loader's catch would turn that into a silently missing capability.
 *
 * Naming the directory after the platform is what lets one tarball carry
 * several and every consumer pick its own. The layout is `prebuildify`'s, so
 * moving to that tool later is a swap rather than a migration.
 */
const root = join(__dirname, '..')
const target = join(
  root,
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'edge_sql.node'
)

mkdirSync(dirname(target), { recursive: true })
copyFileSync(join(root, 'build', 'Release', 'edge_sql.node'), target)
console.log(`Prebuilt ${target.slice(root.length + 1)}`)
