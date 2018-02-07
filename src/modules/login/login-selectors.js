// @flow

import type { ApiInput } from '../root.js'
import type { LoginStashMap } from './login-reducer.js'

export function waitForStashes (ai: ApiInput): Promise<LoginStashMap> {
  // The types for `waitFor` are wrong, since it filters out `undefined`:
  const out: any = ai.waitFor(props => {
    if (props.state.login.stashesLoaded) {
      return props.state.login.stashes
    }
  })
  return out
}
