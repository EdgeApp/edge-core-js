import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'

import { EdgeLog } from '../../src/types/types'
import { expectRejection } from '../expect-rejection'

/**
 * `nym.ts` imports `@nymproject/mix-fetch`, whose entry point is browser-only
 * WASM. These tests replace it in the module cache with a fake that counts how
 * many clients get built, which is the number the cooldown exists to bound:
 * every `createMixFetch` spawns a worker holding megabytes of WASM that the
 * library never lets us terminate.
 */
let setupCount = 0
let setupFails = true
let disconnectHangs = false

const mixFetchPath = require.resolve('@nymproject/mix-fetch')
require.cache[mixFetchPath] = {
  id: mixFetchPath,
  filename: mixFetchPath,
  loaded: true,
  exports: {
    async createMixFetch() {
      ++setupCount
      if (setupFails) throw new Error('gateway client error')
      return { mixFetch: async () => new Response('') }
    },
    async disconnectMixFetch() {
      // The real one is a Comlink RPC into the WASM worker, so it does not
      // complete while that worker is still busy connecting.
      if (disconnectHangs) await new Promise(() => {})
    }
  }
} as unknown as NodeModule

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { makeMixFetchSetup } = require('../../src/util/nym')

const breadcrumbs: string[] = []
const fakeLog: EdgeLog = Object.assign(() => {}, {
  breadcrumb: (message: string) => breadcrumbs.push(message),
  crash: () => {},
  warn: () => {},
  error: () => {}
})

describe('nym mixFetch setup', function () {
  let clock = 0
  let initMixFetch: (log: EdgeLog) => Promise<unknown>

  beforeEach(function () {
    setupCount = 0
    setupFails = true
    disconnectHangs = false
    breadcrumbs.length = 0
    clock = 1_000_000
    ;(global as any).window = {}
    initMixFetch = makeMixFetchSetup(() => clock)
  })

  afterEach(function () {
    delete (global as any).window
  })

  it('builds one client per cooldown window, not one per request', async function () {
    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(1)

    // Every caller during the cooldown fails without building a client. This
    // is the leak the app hit: a poll loop drove a new WASM worker every few
    // seconds until the host killed the JS context.
    for (let i = 0; i < 10; ++i) {
      clock += 2500
      await expectRejection(initMixFetch(fakeLog))
    }
    expect(setupCount).equals(1)
  })

  it('rejects a cooling-down caller with its own error', async function () {
    await expectRejection(initMixFetch(fakeLog))

    // Not the original failure re-thrown: that reports a stale timeout in
    // crash reports, and is not guaranteed to be an `Error` at all.
    clock += 2500
    const error = await initMixFetch(fakeLog).then(
      () => undefined,
      (error: Error & { cause?: unknown }) => error
    )
    expect(error?.message).contains('cooling down')
    expect((error?.cause as Error)?.message).equals('gateway client error')
  })

  it('breadcrumbs once per cooldown window, not once per refused caller', async function () {
    // The app caps Sentry at 25 breadcrumbs. One per refused caller would
    // evict the app's whole crash-report history within a minute of polling.
    await expectRejection(initMixFetch(fakeLog))
    expect(breadcrumbs).deep.equals(['mixFetch setup failed, cooling down'])

    for (let i = 0; i < 10; ++i) {
      clock += 2500
      await expectRejection(initMixFetch(fakeLog))
    }
    expect(breadcrumbs.length).equals(1)

    // A fresh window is worth its own breadcrumb:
    clock += 30000
    await expectRejection(initMixFetch(fakeLog))
    expect(breadcrumbs.length).equals(2)
  })

  it('retries once the cooldown expires, and backs off further', async function () {
    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(1)

    clock += 30000
    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(2)

    // The second failure doubles the wait, so the old 30s is not enough:
    clock += 30000
    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(2)

    clock += 30000
    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(3)
  })

  it('arms the cooldown even when the cleanup disconnect never settles', async function () {
    // Awaiting the disconnect inside the failure path would leave the setup
    // promise pending forever, so callers would hang instead of failing fast
    // and the cooldown would never arm.
    disconnectHangs = true

    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(1)

    clock += 2500
    await expectRejection(initMixFetch(fakeLog))
    expect(setupCount).equals(1)
  })
})
