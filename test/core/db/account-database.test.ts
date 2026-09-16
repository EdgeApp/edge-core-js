import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  accountDatabaseKey,
  accountDatabaseName,
  openAccountDatabases
} from '../../../src/core/db/account-database'
import { EdgeWalletInfo, makeFakeEdgeWorld } from '../../../src/index'
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
    const context = await world.makeEdgeContext({
      ...contextOptions,
      transactionDatabase: true
    })
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

  it('stays closed when the flag is off', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()

    // The default, and what every consumer gets until the cutover:
    expect(openAccountDatabases.size).equals(0)
    await account.logout()
  })
})
