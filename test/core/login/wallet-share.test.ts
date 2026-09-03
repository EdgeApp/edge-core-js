import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  asWalletShareHandshake,
  asWalletSharePayload,
  isViewOnlyWalletKeys,
  makeWalletShareUri,
  parseWalletShareUri,
  REQUEST_WALLETS_URI_PREFIX,
  SHARE_WALLETS_URI_PREFIX
} from '../../../src/core/login/wallet-share'
import { EdgePendingWalletShare, makeFakeEdgeWorld } from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true, unsafecoin: true }
}

async function waitForShare(
  pending: EdgePendingWalletShare
): Promise<EdgePendingWalletShare> {
  if (pending.state === 'done' || pending.state === 'error') return pending
  return await new Promise((resolve, reject) => {
    pending.watch('state', state => {
      if (state === 'done') resolve(pending)
      if (state === 'error') reject(pending.error)
      if (state === 'closed') reject(new Error('share closed'))
    })
  })
}

describe('wallet share cleaners', function () {
  it('round-trips payload', function () {
    const raw = {
      version: 1,
      senderName: 'alice',
      wallets: [
        {
          id: 'PPptx6SBfwGXM+FZURMvYnsOfHpIKZBbqXTCbYmFd44=',
          type: 'wallet:fakecoin',
          keys: {
            syncKey: 'sync',
            dataKey: 'data',
            publicKeys: { fakeAddress: 'addr' }
          },
          mode: 'viewOnly'
        }
      ]
    }
    const clean = asWalletSharePayload(raw)
    expect(clean.wallets[0].mode).equals('viewOnly')
    expect(clean.wallets[0].keys.publicKeys).deep.equals({
      fakeAddress: 'addr'
    })
  })

  it('rejects bad version', function () {
    expect(() =>
      asWalletSharePayload({
        version: 2,
        wallets: []
      })
    ).throws()
  })

  it('round-trips handshake', function () {
    const clean = asWalletShareHandshake({
      version: 1,
      lobbyId: 'abc123'
    })
    expect(clean.lobbyId).equals('abc123')
  })

  it('round-trips the share uri', function () {
    const uri = makeWalletShareUri('request', 'abc123', 'Ada Lovelace')
    expect(uri).equals(
      `${REQUEST_WALLETS_URI_PREFIX}abc123?name=Ada%20Lovelace`
    )
    expect(parseWalletShareUri(uri)).deep.equals({
      direction: 'request',
      lobbyId: 'abc123',
      displayName: 'Ada Lovelace'
    })

    // The offer half, and the deep-link scheme the GUI normalizes to:
    expect(parseWalletShareUri(makeWalletShareUri('offer', 'xyz'))).deep.equals(
      { direction: 'offer', lobbyId: 'xyz', displayName: undefined }
    )
    expect(
      parseWalletShareUri('edge://share-wallets/xyz?name=Bob')
    ).deep.equals({ direction: 'offer', lobbyId: 'xyz', displayName: 'Bob' })

    // A name is optional, and a blank one is the same as none:
    expect(
      parseWalletShareUri('edge://request-wallets/xyz?name=').displayName
    ).equals(undefined)
    expect(() => parseWalletShareUri('https://example.com/nope')).throws(
      SyntaxError
    )
  })

  it('detects view-only keys', function () {
    expect(
      isViewOnlyWalletKeys({
        syncKey: 's',
        dataKey: 'd',
        publicKeys: { fakeAddress: 'a' }
      })
    ).equals(true)
    expect(
      isViewOnlyWalletKeys({
        syncKey: 's',
        dataKey: 'd',
        publicKeys: { fakeAddress: 'a' },
        format: 'bip32',
        coinType: 0
      })
    ).equals(true)
    expect(
      isViewOnlyWalletKeys({
        syncKey: 's',
        dataKey: 'd',
        publicKeys: { fakeAddress: 'a' },
        fakeKey: 'secret'
      })
    ).equals(false)
  })
})

describe('wallet share flows', function () {
  this.timeout(60000)

  it('flow 1: receiver shows QR, view-only share', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const contextA = await world.makeEdgeContext(contextOptions)
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      cleanDevice: true
    })

    const accountA = await contextA.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const accountB = await contextB.createAccount({
      username: 'share-receiver',
      password: 'Password123!',
      pin: '4321'
    })

    const wallet = await accountA.createCurrencyWallet('wallet:fakecoin', {
      name: 'Shared FAKE abc123'
    })
    await wallet.sync()

    const pending = await accountB.requestWalletShare({ displayName: 'Bob' })
    expect(pending.uri.startsWith(REQUEST_WALLETS_URI_PREFIX)).equals(true)

    // The sharer reads who is asking straight off the scanned link:
    const scanned = parseWalletShareUri(pending.uri)
    expect(scanned.direction).equals('request')
    expect(scanned.lobbyId).equals(pending.id)
    expect(scanned.displayName).equals('Bob')

    const done = waitForShare(pending)
    await accountA.approveWalletShare(
      scanned.lobbyId,
      [{ walletId: wallet.id, mode: 'viewOnly' }],
      { displayName: 'Alice', counterpartyName: scanned.displayName }
    )
    const finished = await done

    expect(finished.state).equals('done')
    expect(finished.sharedWallets?.[0].mode).equals('viewOnly')
    expect(finished.receivedWalletIds).deep.equals([wallet.id])
    expect(finished.counterpartyName).equals('Alice')

    const rawKeys = await accountB.getRawPrivateKey(wallet.id)
    expect(Object.keys(rawKeys).sort((a, b) => a.localeCompare(b))).deep.equals(
      ['dataKey', 'publicKeys', 'syncKey'].sort((a, b) => a.localeCompare(b))
    )
    expect(rawKeys.fakeKey).equals(undefined)
    expect(isViewOnlyWalletKeys(rawKeys)).equals(true)
    const walletB = await accountB.waitForCurrencyWallet(wallet.id)
    expect(walletB.canSign).equals(false)
    expect(walletB.viewOnly).equals(true)
    expect(wallet.canSign).equals(true)
    expect(wallet.viewOnly).equals(false)

    // Both sides recorded the exchange against the wallet:
    expect(walletB.sharingState?.sharedFrom).deep.equals([
      {
        name: 'Alice',
        shareType: 'viewOnly',
        sharingDate: walletB.sharingState?.sharedFrom[0].sharingDate
      }
    ])
    expect(walletB.sharingState?.sharedWith).deep.equals([])
    expect(wallet.sharingState?.sharedWith[0].name).equals('Bob')
    expect(wallet.sharingState?.sharedWith[0].shareType).equals('viewOnly')
    expect(
      new Date(
        wallet.sharingState?.sharedWith[0].sharingDate ?? ''
      ).getFullYear()
    ).greaterThan(2000)

    // Same wallet id and public keys:
    expect(accountB.listWalletIds()).includes(wallet.id)
    const publicA = await accountA.getRawPublicKey(wallet.id)
    const publicB = await accountB.getRawPublicKey(wallet.id)
    expect(publicB).deep.equals(publicA)

    // Apply the same view-only share again (mergeKeyInfos deep compare):
    const pending2 = await accountB.requestWalletShare({ displayName: 'Bob' })
    const done2 = waitForShare(pending2)
    await accountA.approveWalletShare(
      pending2.id,
      [{ walletId: wallet.id, mode: 'viewOnly' }],
      { displayName: 'Alice', counterpartyName: 'Bob' }
    )
    await done2

    // A repeat of the same share from the same party adds no audit noise:
    expect(walletB.sharingState?.sharedFrom.length).equals(1)
    expect(wallet.sharingState?.sharedWith.length).equals(1)
  })

  it('records each party separately and never downgrades', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const contextA = await world.makeEdgeContext(contextOptions)
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      cleanDevice: true
    })

    const accountA = await contextA.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const accountB = await contextB.createAccount({
      username: 'share-audit-receiver',
      password: 'Password123!',
      pin: '4321'
    })

    const wallet = await accountA.createCurrencyWallet('wallet:fakecoin', {
      name: 'Audited FAKE'
    })
    await wallet.sync()

    // Alice shares it to spend:
    const first = await accountB.requestWalletShare({ displayName: 'Bob' })
    const firstDone = waitForShare(first)
    await accountA.approveWalletShare(
      first.id,
      [{ walletId: wallet.id, mode: 'spend' }],
      { displayName: 'Alice', counterpartyName: 'Bob' }
    )
    await firstDone

    const walletB = await accountB.waitForCurrencyWallet(wallet.id)
    expect(walletB.viewOnly).equals(false)
    expect(walletB.canSign).equals(true)

    // The same party re-shares it view-only. The keys must not regress, and
    // the differing capability earns its own audit entry:
    const second = await accountB.requestWalletShare({ displayName: 'Bob' })
    const secondDone = waitForShare(second)
    await accountA.approveWalletShare(
      second.id,
      [{ walletId: wallet.id, mode: 'viewOnly' }],
      { displayName: 'Alice', counterpartyName: 'Bob' }
    )
    await secondDone

    expect(walletB.canSign).equals(true)
    expect(walletB.viewOnly).equals(false)
    const keys = await accountB.getRawPrivateKey(wallet.id)
    expect(keys.fakeKey).equals('FakePrivateKey')

    const sharedFrom = walletB.sharingState?.sharedFrom ?? []
    expect(sharedFrom.length).equals(2)
    expect(sharedFrom.map(record => record.shareType)).deep.equals([
      'spend',
      'viewOnly'
    ])
    expect(sharedFrom.every(record => record.name === 'Alice')).equals(true)
  })

  it('shares two wallets at independent modes in one share', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const contextA = await world.makeEdgeContext(contextOptions)
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      cleanDevice: true
    })

    const accountA = await contextA.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const accountB = await contextB.createAccount({
      username: 'share-mixed-receiver',
      password: 'Password123!',
      pin: '4321'
    })

    const viewWallet = await accountA.createCurrencyWallet('wallet:fakecoin', {
      name: 'Mixed view-only'
    })
    const spendWallet = await accountA.createCurrencyWallet('wallet:fakecoin', {
      name: 'Mixed spend'
    })
    await viewWallet.sync()
    await spendWallet.sync()

    const pending = await accountB.requestWalletShare()
    const done = waitForShare(pending)
    await accountA.approveWalletShare(pending.id, [
      { walletId: viewWallet.id, mode: 'viewOnly' },
      { walletId: spendWallet.id, mode: 'spend' }
    ])
    const finished = await done

    expect(finished.state).equals('done')
    const byName = (a: string, b: string): number => a.localeCompare(b)
    expect(finished.receivedWalletIds?.slice().sort(byName)).deep.equals(
      [viewWallet.id, spendWallet.id].sort(byName)
    )

    // Each wallet arrived in its own mode:
    const viewKeys = await accountB.getRawPrivateKey(viewWallet.id)
    expect(isViewOnlyWalletKeys(viewKeys)).equals(true)
    expect(viewKeys.fakeKey).equals(undefined)

    const spendKeys = await accountB.getRawPrivateKey(spendWallet.id)
    expect(isViewOnlyWalletKeys(spendKeys)).equals(false)
    expect(spendKeys.fakeKey).equals(
      (await accountA.getRawPrivateKey(spendWallet.id)).fakeKey
    )

    const viewWalletB = await accountB.waitForCurrencyWallet(viewWallet.id)
    const spendWalletB = await accountB.waitForCurrencyWallet(spendWallet.id)
    expect(viewWalletB.canSign).equals(false)
    expect(spendWalletB.canSign).equals(true)
  })

  it('flow 2: sharer shows QR, spend share + upgrade', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const contextA = await world.makeEdgeContext(contextOptions)
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      cleanDevice: true
    })

    const accountA = await contextA.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const accountB = await contextB.createAccount({
      username: 'share-receiver-2',
      password: 'Password123!',
      pin: '4321'
    })

    const wallet = await accountA.createCurrencyWallet('wallet:fakecoin')

    // First view-only via offer/accept:
    const offer = await accountA.offerWalletShare(
      [{ walletId: wallet.id, mode: 'viewOnly' }],
      { displayName: 'Alice' }
    )
    expect(offer.uri.startsWith(SHARE_WALLETS_URI_PREFIX)).equals(true)

    // The receiver sees who is offering before accepting:
    const scanned = parseWalletShareUri(offer.uri)
    expect(scanned.direction).equals('offer')
    expect(scanned.lobbyId).equals(offer.id)
    expect(scanned.displayName).equals('Alice')

    const accept = await accountB.acceptWalletShare(scanned.lobbyId, {
      displayName: 'Bob',
      counterpartyName: scanned.displayName
    })
    const finishedOffer = await waitForShare(offer)
    expect(finishedOffer.state).equals('done')
    expect(finishedOffer.counterpartyName).equals('Bob')
    const finishedAccept = await waitForShare(accept)
    expect(finishedAccept.state).equals('done')
    expect(finishedAccept.sharedWallets?.[0].mode).equals('viewOnly')
    expect(finishedAccept.counterpartyName).equals('Alice')

    // Names land on the wallet from both directions:
    const walletB = await accountB.waitForCurrencyWallet(wallet.id)
    expect(walletB.sharingState?.sharedFrom[0].name).equals('Alice')
    expect(wallet.sharingState?.sharedWith[0].name).equals('Bob')

    let keys = await accountB.getRawPrivateKey(wallet.id)
    expect(keys.fakeKey).equals(undefined)

    // Upgrade to spend:
    const offerSpend = await accountA.offerWalletShare([
      { walletId: wallet.id, mode: 'spend' }
    ])
    const acceptSpend = await accountB.acceptWalletShare(offerSpend.id)
    await waitForShare(offerSpend)
    await waitForShare(acceptSpend)

    keys = await accountB.getRawPrivateKey(wallet.id)
    expect(keys.fakeKey).equals('FakePrivateKey')
    const keysA = await accountA.getRawPrivateKey(wallet.id)
    expect(keys.fakeKey).equals(keysA.fakeKey)
  })

  it('rejects view-only for unsafeSyncNetwork plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const contextA = await world.makeEdgeContext(contextOptions)
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      cleanDevice: true
    })

    const accountA = await contextA.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const accountB = await contextB.createAccount({
      username: 'share-receiver-3',
      password: 'Password123!',
      pin: '4321'
    })

    const wallet = await accountA.createCurrencyWallet('wallet:unsafecoin')
    const pending = await accountB.requestWalletShare()

    try {
      await accountA.approveWalletShare(pending.id, [
        { walletId: wallet.id, mode: 'viewOnly' }
      ])
      throw new Error('expected view-only share of unsafecoin to fail')
    } catch (error: unknown) {
      expect(String(error)).includes('unsafecoin')
      expect(String(error)).includes('viewOnly')
    }
    await pending.cancelRequest()
  })
})
