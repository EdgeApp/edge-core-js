// @flow
import type {
  AbcConsole,
  AbcIo,
  AbcScryptFunction,
  DiskletFolder,
  FetchFunction,
  RandomFunction
} from 'airbitz-core-types'
import { makeLocalStorageFolder } from 'disklet'

import { scrypt } from '../util/crypto/scrypt.js'

// None of the io resources are optional at this point,
// so this is a separate type:
export type FixedIo = {
  console: AbcConsole,
  fetch: FetchFunction,
  folder: DiskletFolder,
  random: RandomFunction,
  scrypt: AbcScryptFunction
}

/**
 * Checks the properties of an `io` object,
 * upgrading obsolete ones and verifying that we have all necessary ones.
 */
export function fixIo (io: AbcIo): FixedIo {
  const out = {}

  // Copy native io resources:
  const keys = ['console', 'fetch', 'folder', 'random', 'scrypt']
  for (const key of keys) {
    out[key] = io[key]
  }

  // If there is no native folder, try `localStorage` instead:
  if (out.folder == null && io.localStorage != null) {
    out.folder = makeLocalStorageFolder(io.localStorage, {
      prefix: 'airbitz'
    })
  }

  // If there is no scrypt, use the JS one:
  if (out.scrypt == null) {
    out.scrypt = scrypt
  }

  // Verify that we have what we need:
  for (const key of keys) {
    if (out[key] == null) {
      throw new Error(`Could not find "${key}" in the environment`)
    }
  }

  // The network interface (used by plugins):
  if (io.net != null) out.net = io.net

  return (out: any)
}
