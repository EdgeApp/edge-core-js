// @flow

import {
  type EdgeContext,
  type EdgeFakeContextOptions
} from '../types/types.js'
import { prepareFakeIos } from './fake/fake-io.js'
import { destroyAllContexts, makeContext } from './root.js'

export { destroyAllContexts, makeContext }
export { makeFakeIos } from './fake/fake-io.js'
export { fakeUser } from './fake/fakeUser.js'
export { fakeUser1 } from './fake/fakeUser1.js'

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
export async function makeFakeContexts (
  ...opts: Array<EdgeFakeContextOptions>
): Promise<Array<EdgeContext>> {
  return prepareFakeIos(opts).then(ios =>
    Promise.all(ios.map((io, i) => makeContext(io, opts[i])))
  )
}
