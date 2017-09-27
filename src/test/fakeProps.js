// @flow
import { makeFakeIos } from '../io/fake/index.js'
import { fixIo } from '../io/fixIo.js'
import type { RootProps } from '../pixies/rootPixie.js'

export function makeFakeProps (): RootProps {
  return {
    dispatch (action: any) {
      return action
    },
    io: fixIo(makeFakeIos(1)[0]),
    onError (e: Error) {},
    output: ({}: any),
    plugins: [],
    state: ({}: any)
  }
}
