import { expect } from 'chai'
import { makeMemoryDisklet } from 'disklet'
import { afterEach, describe, it } from 'mocha'

import { makeRepoPaths } from '../../../src/core/storage/repo'
import { newestCheckpoint } from '../../../src/core/storage/repo-change-manager'
import { storageSyncConfig } from '../../../src/core/storage/storage-actions'
import { syncServerConfig } from '../../../src/core/storage/sync-server-connection'
import { makeFakeIo } from '../../../src/index'
import { asEdgeBox } from '../../../src/types/server-cleaners'
import { snooze } from '../../../src/util/snooze'
import { fakeUser } from '../../fake/fake-user'
import { waitUntil } from '../../wait-until'
import {
  accountRepoId,
  accountSyncKey,
  accountSyncKeyHex,
  getState,
  lastConnection,
  makeStoreGate,
  makeSyncWsHarness
} from './sync-ws-harness'

const savedServerConfig = { ...syncServerConfig }
const savedStorageConfig = { ...storageSyncConfig }

/** A box the fake server accepts. The client never decrypts it. */
const foreignBox = asEdgeBox({
  encryptionType: 0,
  iv_hex: '82454458a5eaa6bc7dc4b4081b9f36d1',
  data_base64:
    'lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=='
})

/** Writes to the account repo as another device would. */
function foreignWrite(
  harness: ReturnType<typeof makeSyncWsHarness>,
  path: string
): void {
  const repo = harness.db.repos.get(accountSyncKeyHex)
  if (repo == null) throw new Error('No account repo')
  repo[path] = foreignBox
  harness.db.touchRepo(accountSyncKeyHex, 1)
}

function accountWalletId(
  context: Parameters<typeof getState>[0]
): string | undefined {
  const state = getState(context)
  const [accountId] = state.accountIds
  if (accountId == null) return
  return state.accounts[accountId].accountWalletInfo.id
}

function accountStatus(
  context: Parameters<typeof getState>[0]
): string | undefined {
  const id = accountWalletId(context)
  if (id == null) return
  return getState(context).storageWallets[id]?.subscription.status
}

describe('sync-server subscriptions', function () {
  afterEach(function () {
    Object.assign(syncServerConfig, savedServerConfig)
    Object.assign(storageSyncConfig, savedStorageConfig)
  })

  it('a crash between notify and sync still pulls on the next launch', async function () {
    this.timeout(15000)
    const harness = makeSyncWsHarness()
    const disklet = makeMemoryDisklet()
    const gate = makeStoreGate()

    // Log in and settle onto the socket:
    const contextA = await harness.makeContext({ disklet, gate })
    await contextA.loginWithPassword(fakeUser.username, fakeUser.password, {
      otpKey: 'HELLO'
    })
    await waitUntil(() => accountStatus(contextA) === 'listening')
    const walletId = accountWalletId(contextA)
    if (walletId == null) throw new Error('No account')
    const preHash = getState(contextA).storageWallets[walletId].status.lastHash
    expect(preHash).equals(harness.db.getRepoCheckpoint(accountSyncKeyHex))

    // Another device writes. The notification arrives, but the pull
    // never completes:
    let crash: (error: Error) => void = () => {}
    gate.reads = new Promise((resolve, reject) => {
      crash = reject
    })
    foreignWrite(harness, 'Crash/test.json')
    const notified = harness.db.getRepoCheckpoint(accountSyncKeyHex)
    await waitUntil(() => gate.parked > 0, 3000, 'the notified pull')
    expect(lastConnection(harness.server).updates).deep.equals([
      [[accountRepoId, notified]]
    ])

    // Nothing on the notification path touched the synced checkpoint:
    expect(getState(contextA).storageWallets[walletId].status.lastHash).equals(
      preHash
    )
    const { baseDisklet } = makeRepoPaths(
      { ...makeFakeIo(), disklet },
      { dataKey: new Uint8Array(0), syncKey: accountSyncKey }
    )
    const onDisk = JSON.parse(await baseDisklet.getText('status.json'))
    expect(onDisk.lastHash).equals(preHash)

    // Crash, and launch again on the same disk:
    await contextA.close()
    crash(new Error('Process died'))
    const contextB = await harness.makeContext({ disklet })
    await contextB.loginWithPassword(fakeUser.username, fakeUser.password, {
      otpKey: 'HELLO'
    })

    // The resubscribe carries the pre-notification checkpoint,
    // so the server reports a change and the client pulls it:
    const connection = lastConnection(harness.server)
    await waitUntil(() => connection.subscribeCalls.length > 0)
    expect(connection.subscribeCalls[0][0]).deep.equals([
      accountRepoId,
      newestCheckpoint(preHash)
    ])
    await waitUntil(
      () =>
        getState(contextB).storageWallets[walletId]?.status.lastHash ===
        notified,
      3000,
      'the pull after relaunch'
    )
    expect(accountStatus(contextB)).equals('listening')
    await contextB.close()
  })

  it('a half-open socket is declared dead and polling resumes', async function () {
    this.timeout(15000)
    syncServerConfig.pingIntervalMs = 20
    syncServerConfig.pingDeadlineMs = 100
    syncServerConfig.reconnectBaseMs = 60000
    syncServerConfig.reconnectMaxMs = 60000
    storageSyncConfig.syncInterval = 30

    const harness = makeSyncWsHarness()
    const gate = makeStoreGate()
    const context = await harness.makeContext({ gate })
    await context.loginWithPassword(fakeUser.username, fakeUser.password, {
      otpKey: 'HELLO'
    })
    await waitUntil(() => accountStatus(context) === 'listening')

    // While listening, heartbeats keep the socket alive,
    // and the account repo does not poll:
    await snooze(150)
    expect(accountStatus(context)).equals('listening')
    const quietCount = gate.getCounts.get(accountSyncKeyHex) ?? 0
    await snooze(150)
    expect(gate.getCounts.get(accountSyncKeyHex) ?? 0).equals(quietCount)

    // The server stops answering, but never closes the socket:
    harness.server.answerPings = false
    const connection = lastConnection(harness.server)
    await waitUntil(
      () => accountStatus(context) === 'unsubscribed',
      1000,
      'the heartbeat deadline'
    )
    // The client hung up; the server never did:
    expect(connection.closed).equals(true)
    expect(harness.server.connections.length).equals(1)

    // Polling is back:
    await waitUntil(
      () => (gate.getCounts.get(accountSyncKeyHex) ?? 0) > quietCount,
      1000,
      'polling to resume'
    )
    await context.close()
  })
})
