// @flow
import type { AbcContextOptions } from 'airbitz-core-types'
import { makeFakeIos } from '../io/fake/index.js'
import { makeCoreRoot } from './root.js'
import type { CoreRoot } from './root.js'
import type { RootProps } from './rootPixie.js'

export function makeFakeProps (
  ...opts: Array<AbcContextOptions>
): Array<RootProps> {
  return makeFakeIos(opts.length).map((io, i) => {
    const coreRoot: CoreRoot = makeCoreRoot({ ...opts[i], io })

    return {
      dispatch (action: any) {
        return action
      },
      coreRoot,
      io: coreRoot.io,
      onError: coreRoot.onError,
      output: coreRoot.output,
      plugins: coreRoot.plugins,
      state: ({}: any)
    }
  })
}
