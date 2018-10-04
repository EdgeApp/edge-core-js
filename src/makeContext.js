// @flow

import { isReactNative } from 'detect-bundler'
import { mapFiles } from 'disklet'
import { makeLocalBridge } from 'yaob'

import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeIo
} from './index.js'
import { makeBrowserIo } from './io/browser/browser-io.js'
import { makeFakeIos } from './io/fake/fake-io.js'
import { fakeStashes } from './io/fake/fakeUser.js'
import { isNode, makeNodeIo } from './io/node/node-io.js'
import { makeReactNativeIo } from './io/react-native/react-native-io.js'
import { type CoreRoot, makeCoreRoot } from './modules/root.js'

function loadStashes (root: CoreRoot, io: EdgeIo): Promise<mixed> {
  const fileArray = mapFiles(io.folder.folder('logins'), (file, name) =>
    file
      .getText()
      .then(text => ({ name, json: JSON.parse(text) }))
      .catch(e => void 0)
  )

  return fileArray.then(files => {
    const out = {}
    for (const file of files) {
      out[file.name] = file.json
    }
    root.redux.dispatch({
      type: 'LOGIN_STASHES_LOADED',
      payload: out
    })
  })
}

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
    if (opts[i].offline) {
      // Disable network access (but leave the sync server up):
      const oldFetch = io.fetch
      const ioHack: any = io
      ioHack.fetch = (url, opts) =>
        /store/.test(url.toString())
          ? oldFetch(url, opts)
          : Promise.reject(new Error('Network error'))
    }
    if (opts[i].apiKey == null) opts[i].apiKey = 'fake'

    const coreRoot = makeCoreRoot(io, opts[i])
    coreRoot.redux.dispatch({
      type: 'LOGIN_STASHES_LOADED',
      payload: opts[i].localFakeUser ? fakeStashes : {}
    })
    return opts[i].tempNoBridge$
      ? coreRoot.output.context.api
      : makeLocalBridge(coreRoot.output.context.api)
  })
}

/**
 * Creates an Edge context for use in the browser.
 */
async function makeBrowserContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const io = makeBrowserIo()

  const coreRoot = makeCoreRoot(io, opts)
  await loadStashes(coreRoot, io)
  return coreRoot.output.context.api
}

/**
 * Creates an Edge context for use on node.js.
 *
 * @param {{ path?: string }} opts Options for creating the context,
 * including the `path` where data should be written to disk.
 */
async function makeNodeContext (
  opts: EdgeContextOptions = {}
): Promise<EdgeContext> {
  const { path = './edge' } = opts
  const io = makeNodeIo(path)

  const coreRoot = makeCoreRoot(io, opts)
  await loadStashes(coreRoot, io)
  return coreRoot.output.context.api
}

/**
 * Creates an Edge context for use with React Native.
 */
async function makeReactNativeContext (
  opts: EdgeContextOptions
): Promise<EdgeContext> {
  const io = await makeReactNativeIo()

  const coreRoot = makeCoreRoot(io, opts)
  await loadStashes(coreRoot, io)
  return coreRoot.output.context.api
}
