import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeMemorySqlSync } from '../../../src/io/node/node-sql-driver'

/**
 * `edge_native_amount_key()` -- the sort key for 256-bit amounts.
 *
 * Native amounts are exact integers up to 2^256, which no SQLite numeric type
 * holds: INTEGER is 64 bits, and REAL would round -- and rounding an amount is
 * not a precision tradeoff here, it is a wrong number reported to a user. They
 * are therefore stored as the decimal strings the plugins already produce, and
 * TEXT compares lexicographically, where "9" sorts after "10".
 *
 * So ordering or ranging over an amount goes through a key instead. Its
 * output is on-disk format -- the index triggers store it -- which makes these
 * cases a compatibility check as much as a correctness one.
 */

const UINT256_MAX =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935'

function keyOf(
  db: ReturnType<typeof makeMemorySqlSync>,
  value: string
): string {
  const rows = db.all<{ k: string | null }>(
    `SELECT edge_native_amount_key('${value}') AS k`
  )
  return String(rows[0].k)
}

describe('native amount sort key', function () {
  it('sorts the way the numbers do', function () {
    const db = makeMemorySqlSync()
    try {
      db.exec('CREATE TABLE t (v TEXT, k TEXT)')

      // Deliberately inserted out of order, and spanning the full signed
      // range a 256-bit amount can take.
      const amounts = [
        '1',
        '-1',
        '0',
        '10',
        '-10',
        '2',
        '-2',
        '99',
        '-99',
        '100',
        '-100',
        UINT256_MAX,
        `-${UINT256_MAX}`
      ]
      for (const amount of amounts) {
        db.run(
          'INSERT INTO t VALUES (?, edge_native_amount_key(?))',
          amount,
          amount
        )
      }

      const sorted = db
        .all<{ v: string }>('SELECT v FROM t ORDER BY k')
        .map(row => row.v)

      expect(sorted).deep.equals([
        `-${UINT256_MAX}`,
        '-100',
        '-99',
        '-10',
        '-2',
        '-1',
        '0',
        '1',
        '2',
        '10',
        '99',
        '100',
        UINT256_MAX
      ])
    } finally {
      db.close()
    }
  })

  it('gives one key to every spelling of zero', function () {
    const db = makeMemorySqlSync()
    try {
      const zero = keyOf(db, '0')
      expect(keyOf(db, '-0')).equals(zero)
      expect(keyOf(db, '000')).equals(zero)
      expect(keyOf(db, '+0')).equals(zero)
    } finally {
      db.close()
    }
  })

  it('ignores leading zeros and a leading plus', function () {
    const db = makeMemorySqlSync()
    try {
      // Otherwise "007" would carry a digit count of 3 and sort above "42".
      expect(keyOf(db, '007')).equals(keyOf(db, '7'))
      expect(keyOf(db, '+42')).equals(keyOf(db, '42'))
      expect(keyOf(db, '-007')).equals(keyOf(db, '-7'))
    } finally {
      db.close()
    }
  })

  it('returns null for anything that is not an integer', function () {
    const db = makeMemorySqlSync()
    try {
      for (const bad of ['', '-', '+', 'abc', '12a', '1.5', ' 1', '1 ']) {
        const rows = db.all<{ k: string | null }>(
          `SELECT edge_native_amount_key('${bad}') AS k`
        )
        expect(rows[0].k, `"${bad}" should have no key`).equals(null)
      }

      const nulls = db.all<{ k: string | null }>(
        'SELECT edge_native_amount_key(NULL) AS k'
      )
      expect(nulls[0].k).equals(null)
    } finally {
      db.close()
    }
  })

  it('keeps its encoding stable', function () {
    const db = makeMemorySqlSync()
    try {
      // These are stored values. Changing the encoding means reindexing every
      // table that holds a key, so a change here should be a deliberate one.
      expect(keyOf(db, '0')).equals('P000')
      expect(keyOf(db, '5')).equals('P0015')
      expect(keyOf(db, '10')).equals('P00210')
      expect(keyOf(db, '-5')).equals('M9984')
      expect(keyOf(db, '-10')).equals('M99789')
    } finally {
      db.close()
    }
  })
})
