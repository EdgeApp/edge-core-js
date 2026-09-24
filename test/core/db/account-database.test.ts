import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  accountDatabaseKey,
  accountDatabaseName,
  closeAccountDatabase,
  findAccountDatabase,
  getAccountDatabase,
  openAccountDatabaseOnce,
  openAccountDatabases
} from '../../../src/core/db/account-database'
import { EdgeInternalIo, EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { fakeWorldTestConfig } from '../../../src/core/fake/fake-world'
import { EdgeWalletInfo, makeFakeEdgeWorld } from '../../../src/index'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { fakeUser } from '../../fake/fake-user'

const plugins = { fakecoin: true }
const quiet = { onLog() {} }
const contextOptions = { apiKey: '', appId: '', plugins }

/** A storage wallet info, with the base64 keys `asEdgeStorageKeys` wants. */
function fakeStorageWallet(fill: number): EdgeWalletInfo {
  const bytes = Buffer.alloc(32, fill).toString('base64')
  return {
    id: Buffer.alloc(32, 7).toString('base64'),
    type: 'account-repo:co.airbitz.wallet',
    keys: { dataKey: bytes, syncKey: bytes }
  }
}

describe('account database', function () {
  it('derives a key from the account data key', function () {
    const key = accountDatabaseKey(fakeStorageWallet(0x11))

    expect(key.length).equals(32)
    // Same input, same key -- or a reboot cannot reopen the file:
    expect([...accountDatabaseKey(fakeStorageWallet(0x11))]).deep.equals([
      ...key
    ])
    // And it is a derivation, not the data key itself. The data key protects
    // the sync repo, and reusing it here would widen what one leak costs.
    expect([...key]).does.not.deep.equal([...Buffer.alloc(32, 0x11)])
  })

  it('gives different accounts different keys', function () {
    expect([
      ...accountDatabaseKey(fakeStorageWallet(0x11))
    ]).does.not.deep.equal([...accountDatabaseKey(fakeStorageWallet(0x12))])
  })

  it('names the file after the storage wallet', function () {
    // base58 of the wallet id, matching how the account's disklet folder is
    // named, so the two sit together on disk.
    expect(accountDatabaseName('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='))
      .is.a('string')
      .with.length.greaterThan(0)
  })

  it('opens on login and closes on logout', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // The pixie opens the database off the login path, so give it a turn:
    await account.waitForAllWallets()
    const open = [...openAccountDatabases.values()]
    expect(open.length, 'no database was opened').equals(1)

    // It is a working database, not just a handle:
    expect(await open[0].driver.query('SELECT 1 AS n')).deep.equals([{ n: 1 }])

    await account.logout()
    expect(openAccountDatabases.size, 'the database outlived the login').equals(
      0
    )
  })

  it('fails the login on a platform with no SQL driver', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      sqlDriver: 'none'
    })
    const errors: unknown[] = []
    context.on('error', error => errors.push(error))

    const first = await rejectionOf(
      context.loginWithPIN(fakeUser.username, fakeUser.pin)
    )
    expect(String(first)).to.include('account database')
    expect(openAccountDatabases.size).equals(0)

    // A tree torn down by that failure would never answer again, so a
    // second login answering at all is what shows it is still standing:
    const second = await rejectionOf(
      context.loginWithPIN(fakeUser.username, fakeUser.pin)
    )
    expect(String(second)).to.include('account database')
    expect(errors, 'the failure reached the context').deep.equals([])

    // The same device with a working binding logs in:
    const working = await world.makeEdgeContext({
      ...contextOptions,
      device: 'phone'
    })
    const account = await working.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.logout()
  })

  it('fails the login when the database will not open even when recreated', async function () {
    const deleted: string[] = []
    fakeWorldTestConfig.onDeleteSqlDatabase = name => deleted.push(name)
    try {
      const world = await makeFakeEdgeWorld([fakeUser], quiet)
      const context = await world.makeEdgeContext({
        ...contextOptions,
        sqlDriver: 'failing'
      })
      const errors: unknown[] = []
      context.on('error', error => errors.push(error))

      const first = await rejectionOf(
        context.loginWithPIN(fakeUser.username, fakeUser.pin)
      )
      expect(String(first)).to.include('account database')
      expect(deleted.length, 'after the first login').equals(1)

      // Each login opens for its own account id, so each gets its retry:
      const second = await rejectionOf(
        context.loginWithPIN(fakeUser.username, fakeUser.pin)
      )
      expect(String(second)).to.include('account database')
      expect(deleted.length, 'after the second login').equals(2)
      expect(errors).deep.equals([])
    } finally {
      fakeWorldTestConfig.onDeleteSqlDatabase = undefined
    }
  })
})

describe('account database handle', function () {
  const walletInfo = fakeStorageWallet(0x21)

  /** An io whose opens wait for `release`, over real in-memory drivers. */
  function gatedIo(): {
    ai: { props: { io: EdgeInternalIo } }
    drivers: EdgeSqlDriver[]
    closed: EdgeSqlDriver[]
    release: () => void
  } {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const drivers: EdgeSqlDriver[] = []
    const closed: EdgeSqlDriver[] = []
    const io: any = {
      async makeSqlDriver() {
        await gate
        const driver = makeMemorySqlDriver()
        const close = driver.close
        driver.close = async () => {
          closed.push(driver)
          await close()
        }
        drivers.push(driver)
        return driver
      }
    }
    return { ai: { props: { io } }, drivers, closed, release }
  }

  it('opens once however many ask', async function () {
    const { ai, release } = gatedIo()
    const a = openAccountDatabaseOnce(ai, walletInfo, 'login0')
    const b = openAccountDatabaseOnce(ai, walletInfo, 'login0')
    expect(a).equals(b)
    release()
    const database = await a
    expect(database).not.equals(null)
    expect(getAccountDatabase(ai, 'login0')).equals(database)
    closeAccountDatabase(ai, 'login0')
  })

  it('throws for an account whose database is not open', async function () {
    const { ai, release } = gatedIo()
    expect(() => getAccountDatabase(ai, 'login0')).throws(
      'Account database is not open'
    )

    // Still opening is not open either:
    const opening = openAccountDatabaseOnce(ai, walletInfo, 'login0')
    expect(() => getAccountDatabase(ai, 'login0')).throws(
      'Account database is not open'
    )
    expect(findAccountDatabase(ai, 'login0')).equals(undefined)
    release()
    await opening
    expect(findAccountDatabase(ai, 'login0')).not.equals(undefined)
    closeAccountDatabase(ai, 'login0')
    expect(findAccountDatabase(ai, 'login0')).equals(undefined)
  })

  it('closes what it opened when the account logged out meanwhile', async function () {
    const { ai, drivers, closed, release } = gatedIo()
    const opening = openAccountDatabaseOnce(ai, walletInfo, 'login0')
    closeAccountDatabase(ai, 'login0')
    release()

    expect(await opening).equals(null)
    expect(drivers.length).greaterThan(0)
    expect(closed).includes(drivers[0])
    expect(() => getAccountDatabase(ai, 'login0')).throws(
      'Account database is not open'
    )
  })

  it('keeps each context to its own accounts', async function () {
    const one = gatedIo()
    const two = gatedIo()
    one.release()
    two.release()
    const a = await openAccountDatabaseOnce(one.ai, walletInfo, 'login0')
    const b = await openAccountDatabaseOnce(two.ai, walletInfo, 'login0')

    // Both contexts count their logins from zero:
    expect(a).not.equals(b)
    expect(getAccountDatabase(one.ai, 'login0')).equals(a)
    expect(getAccountDatabase(two.ai, 'login0')).equals(b)
    closeAccountDatabase(one.ai, 'login0')
    closeAccountDatabase(two.ai, 'login0')
  })
})

/** The error a promise rejects with, failing if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('Expecting this promise to reject')
    },
    (error: unknown) => error
  )
}
