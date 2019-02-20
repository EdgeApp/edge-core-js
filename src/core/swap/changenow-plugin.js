// @flow

import { lt, mul } from 'biggystring'

import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
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

export function makeChangeNowPlugin (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts

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

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote (
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])

      // get the markets:
      const availablePairs = await get(
        'currencies-to/' + request.fromCurrencyCode
      )
      const fixedMarket = await get('market-info/fixed-rate/' + apiKey) // Promise.all([fetchCurrencies()])

      const quoteAmount =
        request.quoteFor === 'from'
          ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
          : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

      // Swap the currencies if we need a reverse quote:
      const quoteParams =
        request.quoteFor === 'from'
          ? {
            from: request.fromCurrencyCode.toLowerCase(),
            to: request.toCurrencyCode.toLowerCase(),
            amount: quoteAmount
          }
          : {
            from: request.toCurrencyCode.toLowerCase(),
            to: request.fromCurrencyCode.toLowerCase(),
            amount: quoteAmount
          }

      const pairsToUse = []
      let useFixed = false
      let fromAmount, fromNativeAmount, toNativeAmount
      let pairItem
      let quoteReplyKeep = { estimatedAmount: '0' }
      for (let i = 0; i < availablePairs.length; i++) {
        const obj = availablePairs[i]
        if (request.toCurrencyCode.toLowerCase() === obj.ticker) {
          pairsToUse.push(obj)
          if (obj.supportsFixedRate) {
            let minerFee = null
            let rate = null
            useFixed = true
            for (let j = 0; j < fixedMarket.length; j++) {
              const item = fixedMarket[j]
              if (
                item.from === quoteParams.from &&
                item.to === quoteParams.to
              ) {
                pairItem = item
                const [nativeMax, nativeMin] = await Promise.all([
                  request.fromWallet.denominationToNative(
                    item.max.toString(),
                    request.fromCurrencyCode
                  ),
                  request.fromWallet.denominationToNative(
                    item.min.toString(),
                    request.fromCurrencyCode
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
                    request.fromCurrencyCode,
                    request.toCurrencyCode
                  )
                }
                minerFee = item.minerFee
                rate = item.rate
                quoteReplyKeep = quoteReply
              }
            }
            if (pairItem) {
              if (request.quoteFor === 'from') {
                fromAmount = quoteAmount
                fromNativeAmount = request.nativeAmount
                toNativeAmount = await request.toWallet.denominationToNative(
                  quoteReplyKeep.estimatedAmount.toString(),
                  request.toCurrencyCode
                )
              } else {
                fromAmount = mul(
                  quoteReplyKeep.estimatedAmount.toString(),
                  '1.02'
                )
                fromNativeAmount = await request.fromWallet.denominationToNative(
                  fromAmount,
                  request.fromCurrencyCode
                )
                toNativeAmount = request.nativeAmount
              }
              const sendReply = await call({
                route: 'transactions/fixed-rate/',
                body: {
                  amount: fromAmount,
                  from: request.fromCurrencyCode,
                  to: request.toCurrencyCode,
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
                currencyCode: request.fromCurrencyCode,
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
              const tx = await request.fromWallet.makeSpend(spendInfo)
              tx.otherParams.payinAddress =
                spendInfo.spendTargets[0].publicAddress
              tx.otherParams.uniqueIdentifier =
                spendInfo.spendTargets[0].otherParams.uniqueIdentifier

              return makeSwapPluginQuote(
                request,
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
          request.fromCurrencyCode,
          request.toCurrencyCode
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
      if (request.quoteFor === 'from') {
        fromAmount = quoteAmount
        fromNativeAmount = request.nativeAmount
        toNativeAmount = await request.toWallet.denominationToNative(
          quoteReply.estimatedAmount.toString(),
          request.toCurrencyCode
        )
      } else {
        fromAmount = mul(quoteReply.estimatedAmount.toString(), '1.02')
        fromNativeAmount = await request.fromWallet.denominationToNative(
          fromAmount,
          request.fromCurrencyCode
        )
        toNativeAmount = request.nativeAmount
      }
      console.log('CN: estQuery quoteReply  ', quoteReply)
      const min = await get(
        'min-amount/' + quoteParams.from + '_' + quoteParams.to
      )
      console.log('CN: min  ', min)
      const [nativeMin] = await Promise.all([
        request.fromWallet.denominationToNative(
          min.minAmount.toString(),
          request.fromCurrencyCode
        )
      ])
      if (lt(fromNativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      const sendReply = await call({
        route: 'transactions/',
        body: {
          amount: fromAmount,
          from: request.fromCurrencyCode.toLowerCase(),
          to: request.toCurrencyCode.toLowerCase(),
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
        currencyCode: request.fromCurrencyCode,
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
      const tx = await request.fromWallet.makeSpend(spendInfo)
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      return makeSwapPluginQuote(
        request,
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
