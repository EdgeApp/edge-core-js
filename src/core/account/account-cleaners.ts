import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString,
  Cleaner
} from 'cleaners'

import { asBase16 } from '../../types/server-cleaners'
import { EdgeDenomination, EdgeToken } from '../../types/types'
import { asJsonObject } from '../../util/file-helpers'
import { SwapSettings } from './account-types'

// ---------------------------------------------------------------------
// building-block types
// ---------------------------------------------------------------------

const asEdgeDenomination: Cleaner<EdgeDenomination> = asObject({
  multiplier: asString,
  name: asString,
  symbol: asOptional(asString)
})

const asEdgeToken: Cleaner<EdgeToken> = asObject({
  currencyCode: asString,
  denominations: asArray(asEdgeDenomination),
  displayName: asString,
  networkLocation: asOptional(asJsonObject)
})

const asSwapSettings: Cleaner<SwapSettings> = asObject({
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
export const asWalletStateFile = asObject({
  id: asString,
  archived: asOptional(asBoolean),
  deleted: asOptional(asBoolean),
  hidden: asOptional(asBoolean),
  migratedFromWalletId: asOptional(asString),
  sortIndex: asOptional(asNumber)
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
