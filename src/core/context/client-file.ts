import { asBoolean, asMaybe, asNumber, asObject } from 'cleaners'

import { asBase64 } from '../../types/server-cleaners'
import { makeJsonFile } from '../../util/file-helpers'

export const CLIENT_FILE_NAME = 'client.json'

export interface ClientInfo {
  clientId: Uint8Array
  /**
   * This is a boolean flag that puts the device into duress mode.
   */
  duressEnabled: boolean

  /**
   * The login wait timestamps for each account.
   */
  loginWaitTimestamps: {
    [loginId: string]: number | undefined
  }
}

export const clientFile = makeJsonFile<ClientInfo>(
  asObject({
    clientId: asBase64,
    duressEnabled: asMaybe(asBoolean, false),
    loginWaitTimestamps: asMaybe(asObject(asNumber), () => ({}))
  })
)
