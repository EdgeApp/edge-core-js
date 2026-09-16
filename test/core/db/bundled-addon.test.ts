import { expect } from 'chai'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { describe, it } from 'mocha'
import { join } from 'path'

/**
 * The addon has to load from the *built* bundle, not only from source.
 *
 * Everything else in this suite runs the TypeScript through sucrase, so it
 * reads the addon from `src/io/node`. A consumer reads it from `lib/node`,
 * one directory shallower -- and a relative path that works from one resolves
 * outside the package from the other, silently, leaving every SQL feature
 * switched off with no error anywhere. That is how this was found: by a
 * plugin, not by a test.
 *
 * It runs in a child process because loading the bundle beside the source
 * registers the same yaob names twice.
 */
describe('bundled addon', function () {
  it('loads from the built bundle', function () {
    const bundle = join(__dirname, '../../../lib/node/index.js')
    if (!existsSync(bundle)) {
      // `npm run prepare` has not run yet. `npm run verify` builds first.
      this.skip()
      return
    }

    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(bundle)})
           .makeMemoryTxDatabase({
             walletId: Buffer.alloc(32, 0x11).toString('base64'),
             pluginId: 'bitcoin'
           })
           .then(db => db.getTxs())
           .then(txs => console.log('ok', txs.length))
           .catch(error => {
             console.log('failed', error.message)
             process.exit(1)
           })`
      ],
      { encoding: 'utf8' }
    )
    expect(out.trim()).equals('ok 0')
  })
})
