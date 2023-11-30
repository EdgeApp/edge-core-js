import { asObject, asOptional, asString } from 'cleaners'

import {
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapPluginStatus,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapCurrencyError,
  SwapPermissionError
} from '../../src/index'

const swapInfo: EdgeSwapInfo = {
  displayName: 'Fake Swapper',
  pluginId: 'fakeswap',

  supportEmail: 'support@fakeswap'
}

const asFakeSwapSettings = asObject({
  kycToken: asOptional(asString)
})

export const fakeSwapPlugin: EdgeSwapPlugin = {
  swapInfo,

  checkSettings(userSettings: object): EdgeSwapPluginStatus {
    const cleanSettings = asFakeSwapSettings(userSettings)
    return { needsActivation: cleanSettings.kycToken == null }
  },

  fetchSwapQuote(
    request: EdgeSwapRequest,
    userSettings: object = {}
  ): Promise<EdgeSwapQuote> {
    const cleanSettings = asFakeSwapSettings(userSettings)

    // We need KYC:
    if (cleanSettings.kycToken == null) {
      throw new SwapPermissionError(swapInfo, 'noVerification')
    }

    // We don't actually support any currencies:
    throw new SwapCurrencyError(swapInfo, request)
  }
}
