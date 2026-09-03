import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'

import { asBase16 } from '../../types/server-cleaners'
import { EdgeDenomination, EdgeToken } from '../../types/types'
import { asJsonObject } from '../../util/file-helpers'
import { SwapSettings } from './account-types'

// ---------------------------------------------------------------------
// building-block types
// ---------------------------------------------------------------------

const asEdgeDenomination = asObject<EdgeDenomination>({
  multiplier: asString,
  name: asString,
  symbol: asOptional(asString)
})

const asEdgeToken = asObject<EdgeToken>({
  currencyCode: asString,
  denominations: asArray(asEdgeDenomination),
  displayName: asString,
  networkLocation: asOptional(asJsonObject)
})

const asSwapSettings = asObject<SwapSettings>({
  enabled: asOptional(asBoolean, true)
}).withRest

// ---------------------------------------------------------------------
// file types
// ---------------------------------------------------------------------

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
/** One party's side of a single share. */
export const asWalletShareRecord = asObject({
  name: asString,
  shareType: asValue('viewOnly', 'spend'),
  sharingDate: asString
})

/**
 * A wallet's sharing history. Rides in the wallet state file so it syncs to
 * the user's other devices alongside the sort order.
 */
export const asWalletSharingState = asObject({
  sharedWith: asOptional(asArray(asWalletShareRecord), () => []),
  sharedFrom: asOptional(asArray(asWalletShareRecord), () => [])
})

export const asWalletStateFile = asObject({
  id: asString,
  archived: asOptional(asBoolean),
  deleted: asOptional(asBoolean),
  hidden: asOptional(asBoolean),
  migratedFromWalletId: asOptional(asString),
  sortIndex: asOptional(asNumber),
  sharing: asOptional(asWalletSharingState)
})

/**
 * Stores settings for currency and swap plugins.
 */
export const asPluginSettingsFile = asObject({
  // Currency plugins:
  userSettings: asOptional(asObject(asJsonObject), () => ({})),

  // Swap plugins:
  swapSettings: asOptional(asObject(asSwapSettings), () => ({}))
}).withRest

/**
 * The settings file managed by the GUI.
 */
export const asGuiSettingsFile = asObject({
  customTokens: asArray(
    asObject({
      contractAddress: asString,
      currencyCode: asString,
      currencyName: asString,
      denomination: asString,
      denominations: asArray(asEdgeDenomination),
      isVisible: asOptional(asBoolean, true),
      multiplier: asString,
      walletType: asOptional(asString, 'wallet:ethereum')
    })
  )
})

export const asCustomTokensFile = asObject({
  customTokens: asObject(asObject(asEdgeToken))
})
