import { asObject, uncleaner } from 'cleaners'

import { asBase64 } from '../../browser'
import { ApiInput } from '../root-pixie'

export const asEdgeStorageKeys = asObject({
  dataKey: asBase64,
  syncKey: asBase64
})
export const wasEdgeStorageKeys = uncleaner(asEdgeStorageKeys)
export type EdgeStorageKeys = ReturnType<typeof asEdgeStorageKeys>

/**
 * Makes keys for accessing an encrypted Git repo.
 */
export function createStorageKeys(ai: ApiInput): EdgeStorageKeys {
  const { io } = ai.props
  return {
    dataKey: io.random(32),
    syncKey: io.random(20)
  }
}
