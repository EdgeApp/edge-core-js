import { expect } from 'chai'
import { existsSync, readdirSync, rmSync } from 'fs'
import { describe, it } from 'mocha'
import { tmpdir } from 'os'
import { join } from 'path'

import { makeScratchDatabase } from '../../../src/core/db/scratch-database'
import { makeNodeIo } from '../../../src/index'
import { EdgeTx } from '../../../src/types/types'

/**
 * Throwaway storage, for a wallet that is not the user's.
 *
 * Sweeping a private key builds one, syncs it and forgets it. The two things
 * that have to be true are that its transactions never reach the user's own
 * history, and that nothing about the imported key survives it.
 */

function makeTx(walletId: string): EdgeTx {
  return {
    walletId,
    txid: 'swept',
    pluginId: 'bitcoin',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 1,
    isSend: false,
    nativeAmounts: new Map([[null, '500']]),
    networkFees: new Map(),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map()
  }
}

describe('scratch database', function () {
  it('is a working database of its own', async function () {
    const path = join(tmpdir(), `edge-scratch-${process.pid}-a`)
    try {
      const io = makeNodeIo(path)
      const db = await makeScratchDatabase(io, 'bitcoin')

      await db.defineTables({ version: 1, tables: { utxo: { key: ['id'] } } })
      await db.putRows([{ table: 'utxo', rows: [{ id: 'u1' }] }])
      expect((await db.findRows('utxo', {})).length).equals(1)

      await db.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('deletes itself when closed', async function () {
    const path = join(tmpdir(), `edge-scratch-${process.pid}-b`)
    try {
      const io = makeNodeIo(path)
      const db = await makeScratchDatabase(io, 'bitcoin')
      await db.saveTxs([makeTx('ignored')])

      const dir = join(path, 'databases')
      expect(readdirSync(dir).some(name => name.startsWith('scratch-'))).equals(
        true
      )

      await db.close()

      // Nothing about the imported key is left behind, which matters more
      // here than anywhere else in this design.
      expect(readdirSync(dir).some(name => name.startsWith('scratch-'))).equals(
        false
      )
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('keeps two of them apart', async function () {
    const path = join(tmpdir(), `edge-scratch-${process.pid}-c`)
    try {
      const io = makeNodeIo(path)
      const first = await makeScratchDatabase(io, 'bitcoin')
      const second = await makeScratchDatabase(io, 'bitcoin')

      await first.saveTxs([makeTx('ignored')])

      // Two sweeps at once must not see each other's transactions:
      expect((await first.getTxs()).length).equals(1)
      expect((await second.getTxs()).length).equals(0)

      await first.close()
      await second.close()
      expect(existsSync(join(path, 'databases'))).equals(true)
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })
})
