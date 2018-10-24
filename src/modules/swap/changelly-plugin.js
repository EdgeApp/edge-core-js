// @flow

import { lt, mul } from 'biggystring'
import { base16 } from 'rfc4648'

import {
  type EdgePluginEnvironment,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuoteOptions,
  type EdgeSwapTools,
  SwapBelowLimitError
} from '../../index.js'
import { hmacSha512 } from '../../util/crypto/crypto.js'
import { utf8 } from '../../util/encoding.js'
import { makeSwapPluginQuote } from './swap-helpers.js'

const uri = 'https://api.changelly.com'
const expirationMs = 1000 * 60 * 20

type QuoteInfo = {
  id: string,
  apiExtraFee: string,
  changellyFee: string,
  payinExtraId: string | null,
  payoutExtraId: string | null,
  amountExpectedFrom: number,
  status: 'new',
  currencyFrom: string,
  currencyTo: string,
  amountTo: number,
  payinAddress: string,
  payoutAddress: string,
  createdAt: string
}

function checkReply (reply: Object) {
  if (reply.error != null) {
    throw new Error('Changelly error: ' + JSON.stringify(reply.error))
  }
}

function makeChangellyTools (env): EdgeSwapTools {
  if (
    env.initOptions == null ||
    env.initOptions.apiKey == null ||
    env.initOptions.secret == null
  ) {
    throw new Error('No Changelly apiKey or secret provided.')
  }
  const { apiKey } = env.initOptions
  const secret = utf8.parse(env.initOptions.secret)

  async function call (json: any) {
    const body = JSON.stringify(json)
    const sign = base16
      .stringify(hmacSha512(utf8.parse(body), secret))
      .toLowerCase()

    const headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      sign
    }
    const reply = await env.io.fetch(uri, { method: 'POST', body, headers })
    if (!reply.ok) {
      throw new Error(`Changelly returned error code ${reply.status}`)
    }
    return reply.json()
  }

  const out: EdgeSwapTools = {
    needsActivation: false,

    async changeUserSettings (userSettings: Object): Promise<mixed> {},

    async fetchCurrencies (): Promise<Array<string>> {
      const reply = await call({
        jsonrpc: '2.0',
        id: 1,
        method: 'getCurrencies',
        params: {}
      })
      checkReply(reply)
      return reply.result.map(code => code.toUpperCase())
    },

    async fetchQuote (opts: EdgeSwapQuoteOptions): Promise<EdgeSwapPluginQuote> {
      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        opts.fromWallet.getReceiveAddress({
          currencyCode: opts.fromCurrencyCode
        }),
        opts.toWallet.getReceiveAddress({ currencyCode: opts.toCurrencyCode })
      ])

      // Convert the native amount to a denomination:
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
            from: opts.fromCurrencyCode,
            to: opts.toCurrencyCode,
            amount: quoteAmount
          }
          : {
            from: opts.toCurrencyCode,
            to: opts.fromCurrencyCode,
            amount: quoteAmount
          }

      // Get the estimate from the server:
      const quoteReplies = await Promise.all([
        call({
          jsonrpc: '2.0',
          id: 'one',
          method: 'getMinAmount',
          params: {
            from: opts.fromCurrencyCode,
            to: opts.toCurrencyCode
          }
        }),
        call({
          jsonrpc: '2.0',
          id: 'two',
          method: 'getExchangeAmount',
          params: quoteParams
        })
      ])
      checkReply(quoteReplies[0])
      checkReply(quoteReplies[1])

      // Calculate the amounts:
      let fromAmount, fromNativeAmount, toNativeAmount
      if (opts.quoteFor === 'from') {
        fromAmount = quoteAmount
        fromNativeAmount = opts.nativeAmount
        toNativeAmount = await opts.toWallet.denominationToNative(
          quoteReplies[1].result,
          opts.toCurrencyCode
        )
      } else {
        fromAmount = mul(quoteReplies[1].result, '1.02')
        fromNativeAmount = await opts.fromWallet.denominationToNative(
          fromAmount,
          opts.fromCurrencyCode
        )
        toNativeAmount = opts.nativeAmount
      }

      // Check the minimum:
      const nativeMin = await opts.fromWallet.denominationToNative(
        quoteReplies[0].result,
        opts.fromCurrencyCode
      )
      if (lt(fromNativeAmount, nativeMin)) {
        // TODO: If quoteFor === 'to', flip nativeMin around:
        throw new SwapBelowLimitError(nativeMin)
      }

      // Get the address:
      const sendReply = await call({
        jsonrpc: '2.0',
        id: 3,
        method: 'createTransaction',
        params: {
          amount: fromAmount,
          from: opts.fromCurrencyCode,
          to: opts.toCurrencyCode,
          address: toAddress.publicAddress,
          extraId: null, // TODO: Do we need this for Monero?
          refundAddress: fromAddress.publicAddress,
          refundExtraId: null
        }
      })
      checkReply(sendReply)
      const quoteInfo: QuoteInfo = sendReply.result

      // Make the transaction:
      const tx = await opts.fromWallet.makeSpend({
        currencyCode: opts.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.payinAddress,
            uniqueIdentifier: quoteInfo.payinExtraId
          }
        ]
      })

      return makeSwapPluginQuote(
        opts,
        fromNativeAmount,
        toNativeAmount,
        tx,
        'changelly',
        new Date(Date.now() + expirationMs),
        quoteInfo.id
      )
    }
  }

  return out
}

export const changellyPlugin: EdgeSwapPlugin = {
  pluginType: 'swap',
  swapInfo: {
    pluginName: 'changelly',
    displayName: 'Changelly'

    // quoteUri: 'https://changelly.com/transaction/'
  },

  async makeTools (env: EdgePluginEnvironment): Promise<EdgeSwapTools> {
    return makeChangellyTools(env)
  }
}
