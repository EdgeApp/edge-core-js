// @flow

import 'regenerator-runtime/runtime'

import { isReactNative } from 'detect-bundler'

import type { EdgeContext, EdgeContextOptions } from './edge-core-index.js'
import { makeBrowserIo } from './io/browser/browser-io.js'
import { makeFakeIos } from './io/fake/fake-io.js'
import { stashFakeUser } from './io/fake/fakeUser.js'
import { isNode, makeNodeIo } from './io/node/node-io.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import { makeCoreRoot, startCoreRoot } from './modules/root.js'

/**
 * Initializes the Edge core library,
 * automatically selecting the appropriate platform.
 */
export function makeEdgeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  if (isReactNative) return makeReactNativeContext(opts)
  if (isNode) return makeNodeContext(opts)
  return makeBrowserContext(opts)
}

/**
 * Creates one or more fake Edge core library instances for testing.
 *
 * The instances all share the same virtual server,
 * but each context receives its own options.
 *
 * The virtual server comes pre-populated with a testing account.
 * The credentials for this account are available in the 'fakeUser' export.
 * Setting the `localFakeUser` context option to `true` will enable PIN
 * and offline password login for that particular context.
 */
export function makeFakeContexts (
  ...opts: Array<EdgeContextOptions>
): Array<EdgeContext> {
  return makeFakeIos(opts.length).map((io, i) => {
    if (opts[i].localFakeUser) stashFakeUser(io)
    if (opts[i].offline) {
      // Disable network access (but leave the sync server up):
      const oldFetch = io.fetch
      const ioHack: any = io
      ioHack.fetch = (url, opts) =>
        /store/.test(url.toString())
          ? oldFetch(url, opts)
          : Promise.reject(new Error('Network error'))
    }

    const coreRoot = makeCoreRoot(io, opts[i])
    startCoreRoot(coreRoot)
    return coreRoot.output.contextApi
  })
}

/**
 * Creates an Edge context for use in the browser.
 */
function makeBrowserContext (opts: EdgeContextOptions): Promise<EdgeContext> {
  const io = makeBrowserIo()

  const coreRoot = makeCoreRoot(io, opts)
  startCoreRoot(coreRoot)
  return Promise.resolve(coreRoot.output.contextApi)
}

/**
 * Creates an Edge context for use on node.js.
 *
 * @param {{ path?: string }} opts Options for creating the context,
 * including the `path` where data should be written to disk.
 */
function makeNodeContext (opts: EdgeContextOptions = {}): Promise<EdgeContext> {
  const { path = './edge' } = opts
  const io = makeNodeIo(path)

  const coreRoot = makeCoreRoot(io, opts)
  startCoreRoot(coreRoot)
  return Promise.resolve(coreRoot.output.contextApi)
}

/**
 * Creates an Edge context for use with React Native.
 */
function makeReactNativeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  return makeReactNativeIo().then(io => {
    const coreRoot = makeCoreRoot(io, opts)
    startCoreRoot(coreRoot)
    return coreRoot.output.contextApi
  })
}
