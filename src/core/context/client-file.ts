import { asBoolean, asMaybe, asObject } from 'cleaners'

import { asBase64 } from '../../types/server-cleaners'
import { makeJsonFile } from '../../util/file-helpers'

export const CLIENT_FILE_NAME = 'client.json'

export interface ClientInfo {
  clientId: Uint8Array
  /**
   * LoginId of the account which is under duress and is being impersonated
   * by the duress account. It should be the loginId which the duress account
   * is nested under..
   * This is only set if duress mode is activated via pin-login with the
   * duress account's pin.
   */
  duressEnabled: boolean
}

export const clientFile = makeJsonFile<ClientInfo>(
  asObject({
    clientId: asBase64,
    duressEnabled: asMaybe(asBoolean, false)
  })
)
