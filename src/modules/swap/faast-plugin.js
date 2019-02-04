// @flow

import { gt, lt } from 'biggystring'

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
  pluginName: 'faast',
  displayName: 'Faa.st',

  quoteUri: 'https://faa.st/app/orders/',
  supportEmail: 'support@faa.st'
}

const API_PREFIX = 'https://api.faa.st/api/v2/public'

type FaastQuoteJson = {
  swap_id: string,
  created_at: string,
  deposit_address: string,
  deposit_amount: number,
  deposit_currency: string,
  spot_price: number,
  price: number,
  price_locked_at: string,
  price_locked_until: string,
  withdrawal_amount: number,
  withdrawal_address: string,
  withdrawal_currency: string,
  refund_address?: string,
  user_id?: string,
  terms?: string
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

function makeFaastTools (env: EdgePluginEnvironment): EdgeSwapTools {
  const { initOptions = {}, io } = env

  let affiliateOptions = {}
  if (initOptions.affiliateId == null) {
    io.console.info('No faast affiliateId provided.')
  } else {
    const { affiliateId, affiliateMargin } = initOptions
    affiliateOptions = {
      affiliate_id: affiliateId,
      affiliate_margin: affiliateMargin
    }
  }

  async function checkReply (uri: string, reply: Response) {
    let replyJson
    try {
      replyJson = await reply.json()
    } catch (e) {
      throw new Error(
        `Faast ${uri} returned error code ${reply.status} (no JSON)`
      )
    }
    io.console.info('faast reply', replyJson)

    // Faast is not available in some parts of the world:
    if (
      reply.status === 403 &&
      replyJson != null &&
      /geo/.test(replyJson.error)
    ) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
    }

    // Anything else:
    if (!reply.ok || (replyJson != null && replyJson.error != null)) {
      throw new Error(
        `Faast ${uri} returned error code ${
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
    const uri = `${API_PREFIX}${path}`
    io.console.info('faast request', path, body)
    const reply = await io.fetch(uri, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    return checkReply(uri, reply)
  }

  const out: EdgeSwapTools = {
    get needsActivation (): boolean {
      return false
    },

    async changeUserSettings (settings: Object): Promise<mixed> {},

    async fetchCurrencies (): Promise<Array<string>> {
      const currenciesList = await get(`/currencies/`)
      const out = []
      for (const currency of currenciesList) {
        if (currency.deposit && currency.receive) {
          out.push(currency.symbol)
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

      let fromCurrency
      let toCurrency
      let geoInfo
      try {
        ;[fromCurrency, toCurrency, geoInfo] = await Promise.all([
          get(`/currencies/${fromCurrencyCode}`),
          get(`/currencies/${toCurrencyCode}`),
          get('/geoinfo/')
        ])
      } catch (e) {
        if (/not supported/.test(e.message)) {
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )
        }
        throw e
      }
      if (!(fromCurrency.deposit && toCurrency.receive)) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      if (
        geoInfo.blocked ||
        (geoInfo.restricted &&
          (fromCurrency.restricted || toCurrency.restricted))
      ) {
        throw new SwapPermissionError(swapInfo, 'geoRestriction')
      }

      // Check for minimum / maximum:
      if (quoteFor === 'from') {
        let pairInfo
        try {
          pairInfo = await get(`/price/${fromCurrencyCode}_${toCurrencyCode}`)
        } catch (e) {
          if (/not currently supported/.test(e.message)) {
            throw new SwapCurrencyError(
              swapInfo,
              fromCurrencyCode,
              toCurrencyCode
            )
          }
          throw e
        }
        const [nativeMax, nativeMin] = await Promise.all([
          pairInfo.maximum_deposit
            ? fromWallet.denominationToNative(
              pairInfo.maximum_deposit.toString(),
              fromCurrencyCode
            )
            : null,
          fromWallet.denominationToNative(
            pairInfo.minimum_deposit.toString(),
            fromCurrencyCode
          )
        ])
        if (lt(nativeAmount, nativeMin)) {
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        }
        if (nativeMax != null && gt(nativeAmount, nativeMax)) {
          throw new SwapAboveLimitError(swapInfo, nativeMax)
        }
      }

      // Grab addresses:
      const fromAddress = await getAddress(fromWallet, fromCurrencyCode)
      const toAddress = await getAddress(toWallet, toCurrencyCode)

      // Figure out amount:
      let quoteAmount
      if (quoteFor === 'from') {
        const amount = await fromWallet.nativeToDenomination(
          nativeAmount,
          fromCurrencyCode
        )
        quoteAmount = { deposit_amount: Number.parseFloat(amount) }
      } else {
        const amount = await toWallet.nativeToDenomination(
          nativeAmount,
          toCurrencyCode
        )
        quoteAmount = { withdrawal_amount: Number.parseFloat(amount) }
      }

      const body: Object = {
        deposit_currency: fromCurrencyCode,
        withdrawal_currency: toCurrencyCode,
        return_address: fromAddress,
        withdrawal_address: toAddress,
        ...quoteAmount,
        ...affiliateOptions
      }

      let quoteData: FaastQuoteJson
      try {
        quoteData = await post('/swap', body)
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

      const fromNativeAmount = await fromWallet.denominationToNative(
        quoteData.deposit_amount.toString(),
        fromCurrencyCode
      )
      const toNativeAmount = await toWallet.denominationToNative(
        quoteData.withdrawal_amount.toString(),
        toCurrencyCode
      )

      const spendTarget: EdgeSpendTarget = {
        nativeAmount: quoteFor === 'to' ? fromNativeAmount : nativeAmount,
        publicAddress: quoteData.deposit_address
      }

      const spendInfo: EdgeSpendInfo = {
        currencyCode: fromCurrencyCode,
        spendTargets: [spendTarget]
      }
      io.console.info('faast spendInfo', spendInfo)
      const tx = await fromWallet.makeSpend(spendInfo)

      // Convert that to the output format:
      return makeSwapPluginQuote(
        opts,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'faast',
        new Date(quoteData.price_locked_until),
        quoteData.swap_id
      )
    }
  }

  return out
}

export const faastPlugin: EdgeSwapPlugin = {
  pluginType: 'swap',
  swapInfo,

  async makeTools (env: EdgePluginEnvironment): Promise<EdgeSwapTools> {
    return makeFaastTools(env)
  }
}
