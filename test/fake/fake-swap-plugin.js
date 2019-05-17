// @flow

import {
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapPluginStatus,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  SwapCurrencyError,
  SwapPermissionError
} from '../../src/index.js'

const swapInfo: EdgeSwapInfo = {
  displayName: 'Fake Swapper',
  pluginName: 'fakeswap',

  supportEmail: 'support@fakeswap'
}

export const fakeSwapPlugin: EdgeSwapPlugin = {
  swapInfo,

  checkSettings(userSettings: Object): EdgeSwapPluginStatus {
    return { needsActivation: typeof userSettings.kycToken !== 'string' }
  },

  fetchSwapQuote(
    request: EdgeSwapRequest,
    userSettings: Object
  ): Promise<EdgeSwapQuote> {
    // We need KYC:
    if (typeof userSettings.kycToken !== 'string') {
      throw new SwapPermissionError(swapInfo, 'noVerification')
    }

    // We don't actually support any currencies:
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
  }
}
