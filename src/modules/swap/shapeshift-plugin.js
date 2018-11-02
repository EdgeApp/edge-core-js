// @flow

import { div, gt, lt, mul } from 'biggystring'

import {
  type EdgeCurrencyWallet,
  type EdgePluginEnvironment,
  type EdgeSpendInfo,
  type EdgeSpendTarget,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuoteOptions,
  type EdgeSwapTools,
  SameCurrencyError,
  SwapAboveLimitError,
  SwapBelowLimitError
} from '../../index.js'
import { makeSwapPluginQuote } from './swap-helpers.js'

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
  const { io } = env
  if (env.initOptions == null || env.initOptions.apiKey == null) {
    throw new Error('No Shapeshift API key provided')
  }
  const { apiKey } = env.initOptions
  let userSettings = env.userSettings

  async function get (path) {
    const uri = `${API_PREFIX}${path}`
    const reply = await io.fetch(uri)

    if (!reply.ok) {
      throw new Error(`Shapeshift ${uri} returned error code ${reply.status}`)
    }
    const replyJson = await reply.json()
    if (replyJson.error) {
      throw new Error(replyJson.error)
    }
    return replyJson
  }

  async function post (path, body): Object {
    if (userSettings == null || userSettings.accessToken == null) {
      throw new Error('Shapeshift needs activation')
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

    if (!reply.ok) {
      throw new Error(`Shapeshift ${uri} returned error code ${reply.status}`)
    }
    const replyJson = await reply.json()
    if (replyJson.error) {
      throw new Error(replyJson.error)
    }
    return replyJson
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
        throw new SameCurrencyError()
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
          throw new SwapBelowLimitError(nativeMin)
        }
        if (gt(nativeAmount, nativeMax)) {
          throw new SwapAboveLimitError(nativeMax)
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
          throw new SwapBelowLimitError(nativeAmount)
        }
        if (/is greater/.test(e.message)) {
          throw new SwapAboveLimitError(nativeAmount)
        }
        throw new Error(e)
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
      env.io.console.info('shapeshift spendInfo', spendInfo)
      const tx = await fromWallet.makeSpend(spendInfo)

      // Convert that to the output format:
      return makeSwapPluginQuote(
        opts,
        fromNativeAmount,
        toNativeAmount,
        tx,
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
  swapInfo: {
    pluginName: 'shapeshift',
    displayName: 'ShapeShift',

    quoteUri: 'https://shapeshift.io/#/status/',
    supportEmail: 'support@shapeshift.io'
  },

  async makeTools (env: EdgePluginEnvironment): Promise<EdgeSwapTools> {
    return makeShapeshiftTools(env)
  }
}
