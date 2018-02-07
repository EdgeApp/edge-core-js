// @flow

import { mapFiles } from 'disklet'
import { combinePixies, stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'

import type { RootProps } from '../root.js'

export type LoginOutput = {}

export default combinePixies({
  stashes (input: PixieInput<RootProps>) {
    return () => {
      const props: RootProps = input.props

      const fileArray = mapFiles(
        props.io.folder.folder('logins'),
        (file, name) =>
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
        props.dispatch({
          type: 'LOGIN_STASHES_LOADED',
          payload: out
        })
        return stopUpdates
      })
    }
  }
})
