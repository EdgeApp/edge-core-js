import { asObject } from 'cleaners'

import { asBase64 } from '../../types/server-cleaners'
import { makeJsonFile } from '../../util/file-helpers'

export const CLIENT_FILE_NAME = 'client.json'

export const clientFile = makeJsonFile(
  asObject({
    clientId: asBase64
  })
)
