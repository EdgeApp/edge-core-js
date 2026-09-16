import { expect } from 'chai'
import { readFileSync } from 'fs'
import { describe, it } from 'mocha'
import { join } from 'path'

/**
 * The vendored SQLite3MultipleCiphers copy is built three times -- by CMake for
 * Android, by CocoaPods for iOS, and by node-gyp for Node -- and the whole
 * point of vendoring it is that all three run the same SQLite. Nothing at
 * runtime can detect a drift between them, so the compile flags are compared
 * here instead.
 *
 * The README is checked against the amalgamation for the same reason: an
 * upgrade that replaces the code but not the README leaves no other trace.
 */

const rootDir = join(__dirname, '../../..')
const vendorDir = join(rootDir, 'android/src/main/cpp/sqlite3mc')

function read(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8')
}

/** Pulls `SQLITE_*` defines out of a build file, however that file spells them. */
function sqliteDefines(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.matchAll(/SQLITE_[A-Z0-9_]+=\d+/g)) {
    out.add(match[0])
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

describe('vendored SQLite', function () {
  it('README matches the amalgamation it documents', function () {
    const header = readFileSync(
      join(vendorDir, 'sqlite3mc_amalgamation.h'),
      'utf8'
    )
    const readme = readFileSync(join(vendorDir, 'README.md'), 'utf8')

    const cipher =
      /SQLITE3MC_VERSION_STRING\s+"SQLite3 Multiple Ciphers ([\d.]+)"/.exec(
        header
      )
    const sqlite = /#define SQLITE_VERSION\s+"([\d.]+)"/.exec(header)
    if (cipher == null || sqlite == null) {
      throw new Error('Cannot read versions out of the amalgamation header')
    }

    // `expect(huge).includes(...)` would print the whole 700KB header on
    // failure, so compare booleans:
    expect(
      readme.includes(`SQLite3MC ${cipher[1]}, SQLite ${sqlite[1]}`),
      `README should name SQLite3MC ${cipher[1]}, SQLite ${sqlite[1]}`
    ).equals(true)
    expect(
      readme.includes(`releases/tag/v${cipher[1]}`),
      `README should link the v${cipher[1]} release`
    ).equals(true)
  })

  it('builds with the same flags on every platform', function () {
    const cmake = sqliteDefines(read('android/src/main/cpp/CMakeLists.txt'))

    expect(cmake).deep.equals(sqliteDefines(read('edge-core-js.podspec')))
    expect(cmake).includes('SQLITE_ENABLE_FTS5=1')
    expect(cmake).includes('SQLITE_DQS=0')
  })
})
