// @flow

import { lt, mul } from 'biggystring'

import {
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from '../../types/error.js'
import {
  type EdgeCurrencyWallet,
  type EdgePluginEnvironment,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuoteOptions,
  type EdgeSwapTools
} from '../../types/types.js'
import { makeSwapPluginQuote } from './swap-helpers.js'

const swapInfo = {
  pluginName: 'changenow',
  displayName: 'Change NOW',

  quoteUri: 'https://changenow.io/exchange/txs/',
  supportEmail: 'support@changenow.io'
}

const uri = 'https://changenow.io/api/v1/'
const expirationMs = 1000 * 60 * 20

type QuoteInfo = {
  error?: string,
  id: string,
  payinAddress: string,
  payoutAddress: string,
  fromCurrency: string,
  toCurrency: string,
  payinExtraId?: string | null,
  refundAddress: string,
  amount: string,
  rate?: string | null,
  minerFee?: string | null,
  isEstimate: boolean
}

const dontUseLegacy = {
  DGB: true
}

async function getAddress (
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

function checkReply (reply: Object, quoteOpts?: EdgeSwapQuoteOptions) {
  if (reply.error != null) {
    if (
      quoteOpts != null &&
      (reply.error.code === -32602 ||
        /Invalid currency:/.test(reply.error.message))
    ) {
      throw new SwapCurrencyError(
        swapInfo,
        quoteOpts.fromCurrencyCode,
        quoteOpts.toCurrencyCode
      )
    }

    throw new Error('ChangeNow error: ' + JSON.stringify(reply.error))
  }
}

function makeChangeNowTools (env): EdgeSwapTools {
  const { initOptions = {}, io } = env

  if (initOptions.apiKey == null) {
    throw new Error('No ChangeNow apiKey provided.')
  }
  const { apiKey } = initOptions

  async function call (json: any) {
    const body = JSON.stringify(json.body)
    io.console.info('changenow call fixed :', json)
    const headers = {
      'Content-Type': 'application/json'
    }

    const api = uri + json.route + apiKey
    const reply = await io.fetch(api, { method: 'POST', body, headers })
    if (!reply.ok) {
      throw new Error(`ChangeNow fixed returned error code ${reply.status}`)
    }
    const out = await reply.json()
    io.console.info('changenow fixed reply:', out)
    return out
  }

  async function get (path: string) {
    const api = `${uri}${path}`
    const reply = await io.fetch(api)
    return reply.json()
  }

  const out: EdgeSwapTools = {
    needsActivation: false,

    async changeUserSettings (userSettings: Object): Promise<mixed> {},

    async fetchCurrencies (): Promise<Array<string>> {
      const reply = await get('market-info/fixed-rate/' + apiKey)
      checkReply(reply)
      return reply.result.map(code => code.toUpperCase())
    },

    async fetchQuote (opts: EdgeSwapQuoteOptions): Promise<EdgeSwapPluginQuote> {
      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(opts.fromWallet, opts.fromCurrencyCode),
        getAddress(opts.toWallet, opts.toCurrencyCode)
      ])

      // get the markets:
      const availablePairs = await get('currencies-to/' + opts.fromCurrencyCode)
      const fixedMarket = await get('market-info/fixed-rate/' + apiKey) // Promise.all([fetchCurrencies()])

      const quoteAmount =
        opts.quoteFor === 'from'
          ? await opts.fromWallet.nativeToDenomination(
            opts.nativeAmount,
            opts.fromCurrencyCode
          )
          : await opts.toWallet.nativeToDenomination(
            opts.nativeAmount,
            opts.toCurrencyCode
          )

      // Swap the currencies if we need a reverse quote:
      const quoteParams =
        opts.quoteFor === 'from'
          ? {
            from: opts.fromCurrencyCode.toLowerCase(),
            to: opts.toCurrencyCode.toLowerCase(),
            amount: quoteAmount
          }
          : {
            from: opts.toCurrencyCode.toLowerCase(),
            to: opts.fromCurrencyCode.toLowerCase(),
            amount: quoteAmount
          }

      const pairsToUse = []
      let useFixed = false
      let fromAmount, fromNativeAmount, toNativeAmount
      let pairItem
      let quoteReplyKeep = { estimatedAmount: '0' }
      for (let i = 0; i < availablePairs.length; i++) {
        const obj = availablePairs[i]
        if (opts.toCurrencyCode.toLowerCase() === obj.ticker) {
          pairsToUse.push(obj)
          if (obj.supportsFixedRate) {
            let minerFee = null
            let rate = null
            useFixed = true
            for (let j = 0; j < fixedMarket.length; j++) {
              const item = fixedMarket[j]
              if (
                item.from === opts.fromCurrencyCode.toLowerCase() &&
                item.to === obj.ticker
              ) {
                pairItem = item
                const [nativeMax, nativeMin] = await Promise.all([
                  opts.fromWallet.denominationToNative(
                    item.max.toString(),
                    opts.fromCurrencyCode
                  ),
                  opts.fromWallet.denominationToNative(
                    item.min.toString(),
                    opts.fromCurrencyCode
                  )
                ])
                // lets get the quoteObject here
                const estQuery =
                  'exchange-amount/fixed-rate/' +
                  quoteParams.amount +
                  '/' +
                  quoteParams.from +
                  '_' +
                  quoteParams.to +
                  '?api_key=' +
                  apiKey
                const quoteReply = await get(estQuery)
                if (quoteReply.error === 'out_of_range') {
                  if (lt(quoteParams.amount, item.min.toString())) {
                    throw new SwapBelowLimitError(swapInfo, nativeMin)
                  } else {
                    throw new SwapAboveLimitError(swapInfo, nativeMax)
                  }
                }
                if (quoteReply.error) {
                  throw new SwapCurrencyError(
                    swapInfo,
                    opts.fromCurrencyCode,
                    opts.toCurrencyCode
                  )
                }
                minerFee = item.minerFee
                rate = item.rate
                quoteReplyKeep = quoteReply
              }
            }
            if (pairItem) {
              if (opts.quoteFor === 'from') {
                fromAmount = quoteAmount
                fromNativeAmount = opts.nativeAmount
                toNativeAmount = await opts.toWallet.denominationToNative(
                  quoteReplyKeep.estimatedAmount.toString(),
                  opts.toCurrencyCode
                )
              } else {
                fromAmount = mul(
                  quoteReplyKeep.estimatedAmount.toString(),
                  '1.02'
                )
                fromNativeAmount = await opts.fromWallet.denominationToNative(
                  fromAmount,
                  opts.fromCurrencyCode
                )
                toNativeAmount = opts.nativeAmount
              }
              const sendReply = await call({
                route: 'transactions/fixed-rate/',
                body: {
                  amount: fromAmount,
                  from: opts.fromCurrencyCode,
                  to: opts.toCurrencyCode,
                  address: toAddress,
                  extraId: null, // TODO: Do we need this for Monero?
                  refundAddress: fromAddress
                }
              })
              const quoteInfo: QuoteInfo = {
                id: sendReply.id,
                payinAddress: sendReply.payinAddress,
                payoutAddress: sendReply.payoutAddress,
                fromCurrency: sendReply.fromCurrency,
                toCurrency: sendReply.toCurrency,
                payinExtraId: sendReply.payinExtraId || null,
                refundAddress: sendReply.refundAddress,
                amount: sendReply.amount,
                rate: rate || null,
                minerFee: minerFee || null,
                isEstimate: !useFixed
              }
              const spendInfo = {
                currencyCode: opts.fromCurrencyCode,
                spendTargets: [
                  {
                    nativeAmount: fromNativeAmount,
                    publicAddress: quoteInfo.payinAddress,
                    otherParams: {
                      uniqueIdentifier: quoteInfo.payinExtraId
                    }
                  }
                ]
              }
              io.console.info('changenow spendInfo', spendInfo)
              const tx = await opts.fromWallet.makeSpend(spendInfo)
              return makeSwapPluginQuote(
                opts,
                fromNativeAmount,
                toNativeAmount,
                tx,
                toAddress,
                'changenow',
                new Date(Date.now() + expirationMs),
                quoteInfo.id
              )
            }
          }
        }
      }
      if (pairsToUse.length === 0) {
        throw new SwapCurrencyError(
          swapInfo,
          opts.fromCurrencyCode,
          opts.toCurrencyCode
        )
      }
      const estQuery =
        'exchange-amount/' +
        quoteParams.amount +
        '/' +
        quoteParams.from +
        '_' +
        quoteParams.to
      const quoteReply = await get(estQuery)
      if (opts.quoteFor === 'from') {
        fromAmount = quoteAmount
        fromNativeAmount = opts.nativeAmount
        toNativeAmount = await opts.toWallet.denominationToNative(
          quoteReply.estimatedAmount.toString(),
          opts.toCurrencyCode
        )
      } else {
        fromAmount = mul(quoteReply.estimatedAmount.toString(), '1.02')
        fromNativeAmount = await opts.fromWallet.denominationToNative(
          fromAmount,
          opts.fromCurrencyCode
        )
        toNativeAmount = opts.nativeAmount
      }
      console.log('CN: estQuery quoteReply  ', quoteReply)
      const min = await get(
        'min-amount/' + quoteParams.from + '_' + quoteParams.to
      )
      console.log('CN: min  ', min)
      const [nativeMin] = await Promise.all([
        opts.fromWallet.denominationToNative(
          min.minAmount.toString(),
          opts.fromCurrencyCode
        )
      ])
      if (lt(fromNativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      const sendReply = await call({
        route: 'transactions/',
        body: {
          amount: fromAmount,
          from: opts.fromCurrencyCode.toLowerCase(),
          to: opts.toCurrencyCode.toLowerCase(),
          address: toAddress,
          extraId: null, // TODO: Do we need this for Monero?
          refundAddress: fromAddress
        }
      })
      // checkReply(sendReply)
      const quoteInfo: QuoteInfo = {
        id: sendReply.id,
        payinAddress: sendReply.payinAddress,
        payoutAddress: sendReply.payoutAddress,
        fromCurrency: sendReply.fromCurrency,
        toCurrency: sendReply.toCurrency,
        payinExtraId: sendReply.payinExtraId || null,
        refundAddress: sendReply.refundAddress,
        amount: sendReply.amount,
        rate: sendReply.rate || null,
        minerFee: sendReply.minerFee || null,
        isEstimate: !useFixed
      }

      // Make the transaction:
      const spendInfo = {
        currencyCode: opts.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.payinAddress,
            otherParams: {
              uniqueIdentifier: quoteInfo.payinExtraId
            }
          }
        ]
      }
      io.console.info('changenow spendInfo', spendInfo)
      const tx = await opts.fromWallet.makeSpend(spendInfo)

      return makeSwapPluginQuote(
        opts,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'changenow',
        new Date(Date.now() + expirationMs) // ,
        // quoteInfo.id
      )
    }
  }

  return out
}

export const changenowPlugin: EdgeSwapPlugin = {
  pluginType: 'swap',
  swapInfo,

  async makeTools (env: EdgePluginEnvironment): Promise<EdgeSwapTools> {
    return makeChangeNowTools(env)
  }
}
