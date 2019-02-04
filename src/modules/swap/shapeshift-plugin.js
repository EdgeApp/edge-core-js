// @flow

import { div, gt, lt, mul } from 'biggystring'

import {
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from '../../types/error.js'
import {
  type EdgeCurrencyWallet,
  type EdgePluginEnvironment,
  type EdgeSpendInfo,
  type EdgeSpendTarget,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuoteOptions,
  type EdgeSwapTools
} from '../../types/types.js'
import { makeSwapPluginQuote } from './swap-helpers.js'

const swapInfo = {
  pluginName: 'shapeshift',
  displayName: 'ShapeShift',

  quoteUri: 'https://shapeshift.io/#/status/',
  supportEmail: 'support@shapeshift.io'
}

const API_PREFIX = 'https://shapeshift.io'

type ShapeShiftQuoteJson = {
  error?: string,
  success?: {
    pair: string,
    withdrawal: string,
    withdrawalAmount: string,
    deposit: string,
    depositAmount: string,
    expiration: number,
    quotedRate: string,
    apiPubKey: string,
    minerFee: string,
    maxLimit: number,
    orderId: string,
    sAddress?: string
  }
}

const dontUseLegacy = {
  DGB: true
}

async function getAddress (wallet: EdgeCurrencyWallet, currencyCode: string) {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

function makeShapeshiftTools (env: EdgePluginEnvironment): EdgeSwapTools {
  const { initOptions = {}, io } = env
  let { userSettings } = env

  if (initOptions.apiKey == null) {
    throw new Error('No Shapeshift API key provided')
  }
  const { apiKey } = initOptions

  async function checkReply (uri: string, reply: Response) {
    let replyJson
    try {
      replyJson = await reply.json()
    } catch (e) {
      throw new Error(
        `Shapeshift ${uri} returned error code ${reply.status} (no JSON)`
      )
    }
    io.console.info('shapeshift reply', replyJson)

    // Shapeshift is not available in some parts of the world:
    if (
      reply.status === 403 &&
      replyJson != null &&
      replyJson.error != null &&
      replyJson.error.code === 'geoRestriction'
    ) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
    }

    // Shapeshift requires KYC:
    if (
      reply.status === 401 &&
      replyJson != null &&
      replyJson.message === 'You must be logged in with a verified user'
    ) {
      throw new SwapPermissionError(swapInfo, 'noVerification')
    }

    // Anything else:
    if (!reply.ok || (replyJson != null && replyJson.error != null)) {
      throw new Error(
        `Shapeshift ${uri} returned error code ${
          reply.status
        } with JSON ${JSON.stringify(replyJson)}`
      )
    }

    return replyJson
  }

  async function get (path) {
    const uri = `${API_PREFIX}${path}`
    const reply = await io.fetch(uri)
    return checkReply(uri, reply)
  }

  async function post (path, body): Object {
    if (userSettings == null || userSettings.accessToken == null) {
      throw new SwapPermissionError(swapInfo.pluginName, 'needsActivation')
    }
    const uri = `${API_PREFIX}${path}`
    const reply = await io.fetch(uri, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userSettings.accessToken}`
      },
      body: JSON.stringify(body)
    })
    return checkReply(uri, reply)
  }

  const out: EdgeSwapTools = {
    get needsActivation (): boolean {
      return userSettings == null || userSettings.accessToken == null
    },

    async changeUserSettings (settings: Object): Promise<mixed> {
      userSettings = settings
    },

    async fetchCurrencies (): Promise<Array<string>> {
      const json = await get(`/getcoins/`)
      const out = []
      for (const key in json) {
        if (json[key].status === 'available') {
          out.push(key)
        }
      }
      return out
    },

    async fetchQuote (opts: EdgeSwapQuoteOptions): Promise<EdgeSwapPluginQuote> {
      const {
        fromCurrencyCode,
        fromWallet,
        nativeAmount,
        quoteFor,
        toCurrencyCode,
        toWallet
      } = opts
      if (toCurrencyCode === fromCurrencyCode) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Check for supported currencies:
      const json = await get(`/getcoins/`)
      const fromStatus = json[fromCurrencyCode.toUpperCase()]
      const toStatus = json[toCurrencyCode.toUpperCase()]
      if (
        fromStatus == null ||
        toStatus == null ||
        fromStatus.status !== 'available' ||
        toStatus.status !== 'available'
      ) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Bail out early if we need activation:
      if (userSettings == null || userSettings.accessToken == null) {
        throw new SwapPermissionError(swapInfo.pluginName, 'needsActivation')
      }

      // Check for minimum / maximum:
      if (quoteFor === 'from') {
        const json = await get(
          `/marketinfo/${fromCurrencyCode}_${toCurrencyCode}`
        )
        const [nativeMax, nativeMin] = await Promise.all([
          fromWallet.denominationToNative(
            json.limit.toString(),
            fromCurrencyCode
          ),
          fromWallet.denominationToNative(
            json.minimum.toString(),
            fromCurrencyCode
          )
        ])
        if (lt(nativeAmount, nativeMin)) {
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        }
        if (gt(nativeAmount, nativeMax)) {
          throw new SwapAboveLimitError(swapInfo, nativeMax)
        }
      }

      // Grab addresses:
      const fromAddress = await getAddress(fromWallet, fromCurrencyCode)
      const toAddress = await getAddress(toWallet, toCurrencyCode)

      // here we are going to get multipliers
      const multiplierFrom = await fromWallet.denominationToNative(
        '1',
        fromCurrencyCode
      )
      const multiplierTo = await fromWallet.denominationToNative(
        '1',
        toCurrencyCode
      )

      // Figure out amount:
      const quoteAmount =
        quoteFor === 'from'
          ? { depositAmount: div(nativeAmount, multiplierFrom, 16) }
          : { amount: div(nativeAmount, multiplierTo, 16) }
      const body: Object = {
        apiKey,
        pair: `${fromCurrencyCode}_${toCurrencyCode}`,
        returnAddress: fromAddress,
        withdrawal: toAddress,
        ...quoteAmount
      }

      let quoteData: ShapeShiftQuoteJson
      try {
        quoteData = await post('/sendamount', body)
      } catch (e) {
        // TODO: Using the nativeAmount here is technically a bug,
        // since we don't know the actual limit in this case:
        if (/is below/.test(e.message)) {
          throw new SwapBelowLimitError(swapInfo, nativeAmount)
        }
        if (/is greater/.test(e.message)) {
          throw new SwapAboveLimitError(swapInfo, nativeAmount)
        }
        throw e
      }
      if (!quoteData.success) {
        throw new Error('Did not get back successful quote')
      }

      const exchangeData = quoteData.success
      const fromNativeAmount = mul(exchangeData.depositAmount, multiplierFrom)
      const toNativeAmount = mul(exchangeData.withdrawalAmount, multiplierTo)

      const spendTarget: EdgeSpendTarget = {
        nativeAmount: quoteFor === 'to' ? fromNativeAmount : nativeAmount,
        publicAddress: exchangeData.deposit
      }

      // Adjust the spendInfo if we need to provide a tag:
      if (exchangeData.deposit.indexOf('?dt=') !== -1) {
        const splitArray = exchangeData.deposit.split('?dt=')
        spendTarget.publicAddress = splitArray[0]
        spendTarget.otherParams = {
          uniqueIdentifier: splitArray[1]
        }
      }
      if (fromCurrencyCode === 'XMR' && exchangeData.sAddress) {
        spendTarget.publicAddress = exchangeData.sAddress
        spendTarget.otherParams = {
          uniqueIdentifier: exchangeData.deposit
        }
      }

      const spendInfo: EdgeSpendInfo = {
        // networkFeeOption: spendInfo.networkFeeOption,
        currencyCode: fromCurrencyCode,
        spendTargets: [spendTarget]
      }
      io.console.info('shapeshift spendInfo', spendInfo)
      const tx = await fromWallet.makeSpend(spendInfo)

      // Convert that to the output format:
      return makeSwapPluginQuote(
        opts,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'shapeshift',
        new Date(exchangeData.expiration),
        exchangeData.orderId
      )
    }
  }

  return out
}

export const shapeshiftPlugin: EdgeSwapPlugin = {
  pluginType: 'swap',
  swapInfo,

  async makeTools (env: EdgePluginEnvironment): Promise<EdgeSwapTools> {
    return makeShapeshiftTools(env)
  }
}
