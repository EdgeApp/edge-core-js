import {
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapPluginStatus,
  EdgeSwapQuote,
  EdgeSwapRequest,
  JsonObject,
  SwapCurrencyError,
  SwapPermissionError
} from '../../src/index'

const swapInfo: EdgeSwapInfo = {
  displayName: 'Fake Swapper',
  pluginId: 'fakeswap',

  supportEmail: 'support@fakeswap'
}

export const fakeSwapPlugin: EdgeSwapPlugin = {
  swapInfo,

  checkSettings(userSettings: JsonObject): EdgeSwapPluginStatus {
    return { needsActivation: typeof userSettings.kycToken !== 'string' }
  },

  fetchSwapQuote(
    request: EdgeSwapRequest,
    userSettings: JsonObject = {}
  ): Promise<EdgeSwapQuote> {
    // We need KYC:
    if (typeof userSettings.kycToken !== 'string') {
      throw new SwapPermissionError(swapInfo, 'noVerification')
    }

    // We don't actually support any currencies:
    throw new SwapCurrencyError(swapInfo, request)
  }
}
