// @flow

import {
  asBoolean,
  asMap,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import { asBase16 } from '../../types/server-cleaners.js'
import {
  type ReturnType // @ts-delete
} from '../../types/types.js'
import { asJsonObject } from '../../util/file-helpers.js'

/**
 * An Airbitz Bitcoin wallet, which includes the private key & state.
 */
export const asLegacyWalletFile = asObject({
  SortIndex: asOptional(asNumber, 0),
  Archived: asOptional(asBoolean, false),
  BitcoinSeed: asBase16,
  MK: asBase16,
  SyncKey: asBase16
}).withRest

/**
 * An Edge wallet state file. The keys are stored in the login server.
 */
export const asWalletStateFile = asObject({
  id: asString,
  archived: asOptional(asBoolean),
  deleted: asOptional(asBoolean),
  hidden: asOptional(asBoolean),
  sortIndex: asOptional(asNumber)
})

/**
 * Swap plugin settings.
 */
const asSwapSettings = asObject({
  enabled: asOptional(asBoolean, true)
}).withRest
export type SwapSettings = ReturnType<typeof asSwapSettings>

/**
 * Stores settings for currency and swap plugins.
 */
export const asPluginSettingsFile = asObject({
  // Currency plugins:
  userSettings: asOptional(asMap(asJsonObject), {}),

  // Swap plugins:
  swapSettings: asOptional(asMap(asSwapSettings), {})
}).withRest
