// @flow

import { gt, lt, mul } from 'biggystring'

import {
  type EdgeCurrencyWallet,
  type EdgePluginEnvironment,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuoteOptions,
  type EdgeSwapTools,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from '../../index.js'
// import { hmacSha512 } from '../../util/crypto/crypto.js'
// import { utf8 } from '../../util/encoding.js'
import { makeSwapPluginQuote } from './swap-helpers.js'

// import { base16 } from 'rfc4648'

const swapInfo = {
  pluginName: 'changenow',
  displayName: 'Change NOW',

  // quoteUri: 'https://changenow.com/transaction/',
  supportEmail: 'support@changenow.com'
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
  if (env.initOptions == null || env.initOptions.apiKey == null) {
    throw new Error('No ChangeNow apiKey or secret provided.')
  }
  const { apiKey } = env.initOptions

  async function callFixed (json: any) {
    const body = JSON.stringify(json.params)
    env.io.console.info('changenow call fixed :', json)
    const headers = {
      'Content-Type': 'application/json'
    }

    const api = uri + 'transactions/fixed-rate/' + apiKey
    const reply = await env.io.fetch(api, { method: 'POST', body, headers })
    if (!reply.ok) {
      throw new Error(`ChangeNow fixed returned error code ${reply.status}`)
    }
    const out = await reply.json()
    env.io.console.info('changenow fixed reply:', out)
    return out
  }
  async function get (path: string) {
    const api = `${uri}${path}`
    const reply = await env.io.fetch(api)
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
        getAddress(opts.toWallet, '8')
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

      let fromAmount, fromNativeAmount, toNativeAmount
      if (opts.quoteFor === 'from') {
        fromAmount = quoteAmount
        fromNativeAmount = opts.nativeAmount
        toNativeAmount = await opts.toWallet.denominationToNative(
          quoteParams.amount,
          opts.toCurrencyCode
        )
      } else {
        fromAmount = mul(quoteParams.amount, '1.02')
        fromNativeAmount = await opts.fromWallet.denominationToNative(
          fromAmount,
          opts.fromCurrencyCode
        )
        toNativeAmount = opts.nativeAmount
      }

      const pairsToUse = []
      let useFixed = false
      let minerFee = null
      let rate = null
      for (let i = 0; i < availablePairs.length; i++) {
        const obj = availablePairs[i]
        if (opts.toCurrencyCode.toLowerCase() === obj.ticker) {
          pairsToUse.push(obj)
          if (obj.supportsFixedRate) {
            useFixed = true

            for (let j = 0; j < fixedMarket.length; j++) {
              const item = fixedMarket[j]
              if (
                item.from === opts.fromCurrencyCode.toLowerCase() &&
                item.to === obj.ticker
              ) {
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
                if (lt(fromNativeAmount, nativeMin)) {
                  throw new SwapBelowLimitError(swapInfo, nativeMin)
                }
                if (gt(fromNativeAmount, nativeMax)) {
                  throw new SwapAboveLimitError(swapInfo, nativeMax)
                }
                minerFee = item.minerFee
                rate = item.rate
              }
            }
            const sendReply = await callFixed({
              jsonrpc: '2.0',
              id: 3,
              method: 'transactions/fixed-rate/',
              params: {
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
              rate: sendReply.rate || null,
              minerFee: sendReply.minerFee || null,
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
            env.io.console.info('changenow spendInfo', spendInfo)
            const tx = await opts.fromWallet.makeSpend(spendInfo)
            return makeSwapPluginQuote(
              opts,
              fromNativeAmount,
              toNativeAmount,
              tx,
              'changenow',
              new Date(Date.now() + expirationMs),
              quoteInfo.id
            )
          }
        }
      }
      console.log('Now we have to do estimate ', minerFee)
      console.log('Now we have to do estimate ', rate)
      console.log('Now we have to do estimate ')
      console.log('Now we have to do estimate ')
      console.log('Now we have to do estimate ')
      console.log('Now we have to do estimate ')
      console.log('Now we have to do estimate ')
      console.log('Now we have to do estimate ')
      console.log('Now we have to do estimate ')
      // Handle estimate stuff
      // const fixedQuery = 'exchange-amount/fixed-rate/' + quoteParams.amount + '/' + quoteParams.from + '_' + quoteParams.to + '?api_key=' + apiKey
      // const estQuery = 'exchange-amount/' + quoteParams.amount + '/' + quoteParams.from + '_' + quoteParams.to

      // Get the estimate from the server:
      /* const quoteReply = useFixed ? await get(fixedQuery) : await get(estQuery)
      checkReply(quoteReply) */

      // Get the address:
      const sendReply = await callFixed({
        jsonrpc: '2.0',
        id: 3,
        method: 'transactions/fixed-rate/',
        params: {
          amount: fromAmount,
          from: opts.fromCurrencyCode,
          to: opts.toCurrencyCode,
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
      env.io.console.info('changenow spendInfo', spendInfo)
      const tx = await opts.fromWallet.makeSpend(spendInfo)

      return makeSwapPluginQuote(
        opts,
        fromNativeAmount,
        toNativeAmount,
        tx,
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
