import { asObject } from 'cleaners'

import { asBase64 } from '../../types/server-cleaners'
import { makeJsonFile } from '../../util/file-helpers'

export const CLIENT_FILE_NAME = 'client.json'

export const clientFile = makeJsonFile(
  asObject({
    clientId: asBase64,

    // The designated small account to be used as a puppet if there is a problem:
    duressPuppetLoginId: asOptional(asBase64), // loginId

    // Set if we are in durress mode.
    // We will lie about everything and instead just show the
    // duressFallbackLogin instead of showing any other accounts,
    // but give it this fake username.
    duressUsername: asOptional(asString) // username / loginId
  })
)
