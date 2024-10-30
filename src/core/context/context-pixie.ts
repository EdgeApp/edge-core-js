import {
  combinePixies,
  filterPixie,
  stopUpdates,
  TamePixie
} from 'redux-pixies'
import { close, update } from 'yaob'

import { EdgeContext, EdgeLogSettings, EdgeUserInfo } from '../../types/types'
import { makePeriodicTask } from '../../util/periodic-task'
import { shuffle } from '../../util/shuffle'
import { ApiInput, RootProps } from '../root-pixie'
import { makeContextApi } from './context-api'
import {
  asInfoCacheFile,
  INFO_CACHE_FILE_NAME,
  infoCacheFile
} from './info-cache-file'

export interface ContextOutput {
  api: EdgeContext
}

export const context: TamePixie<RootProps> = combinePixies({
  api(ai: ApiInput) {
    return {
      destroy() {
        close(ai.props.output.context.api)
      },
      update() {
        ai.onOutput(makeContextApi(ai))
        return stopUpdates
      }
    }
  },

  watcher(ai: ApiInput) {
    let lastLocalUsers: EdgeUserInfo[] | undefined
    let lastPaused: boolean | undefined
    let lastLogSettings: EdgeLogSettings | undefined

    return () => {
      if (
        lastLocalUsers !== ai.props.state.login.localUsers ||
        lastPaused !== ai.props.state.paused ||
        lastLogSettings !== ai.props.state.logSettings
      ) {
        lastLocalUsers = ai.props.state.login.localUsers
        lastPaused = ai.props.state.paused
        lastLogSettings = ai.props.state.logSettings
        if (ai.props.output.context.api != null) {
          update(ai.props.output.context.api)
        }
      }
    }
  },

  infoFetcher: filterPixie(
    (input: ApiInput) => {
      async function doInfoSync(): Promise<void> {
        const { dispatch, io } = input.props

        const [infoServerUri] = shuffle(input.props.state.infoServers)
        const response = await fetch(`${infoServerUri}/v1/coreRollup`, {
          headers: { accept: 'application/json' }
        })
        if (!response.ok) return
        const json = await response.json()

        const infoCache = asInfoCacheFile(json)
        dispatch({
          type: 'INFO_CACHE_FETCHED',
          payload: infoCache
        })
        await infoCacheFile.save(io.disklet, INFO_CACHE_FILE_NAME, infoCache)
      }

      const infoTask = makePeriodicTask(doInfoSync, 10 * 60 * 1000, {
        onError(error) {
          input.props.onError(error)
        }
      })

      return {
        update() {
          if (!infoTask.started) infoTask.start()
        },
        destroy() {
          infoTask.stop()
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  )
})
