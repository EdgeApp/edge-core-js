// @flow

import { bns } from 'biggystring'

import { getCurrencyMultiplier } from '../currency/currency-selectors'
import type { ApiInput } from '../root.js'

const API_PREFIX = 'https://shapeshift.io'

export interface ShapeshiftReply {
  deposit: string;
  depositType: string;
  withdrawal: string;
  withdrawalType: string;
}

export function makeShapeshiftApi (ai: ApiInput) {
  const io = ai.props.io
  const apiKey = ai.props.shapeshiftKey

  const api = {
    async get (path) {
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
    },

    async post (path, body): Object {
      const uri = `${API_PREFIX}${path}`
      const reply = await io.fetch(uri, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json'
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
  }

  return {
    async getExchangeSwapRate (
      fromCurrency: string,
      toCurrency: string
    ): Promise<number> {
      const pair = `${fromCurrency}_${toCurrency}`
      const json = await api.get(`/rate/${pair}`)
      return +json.rate
    },

    async getAvailableExchangeTokens (): Promise<Array<string>> {
      const json = await api.get(`/getcoins/`)
      const availableTokens = []
      for (const key in json) {
        if (json[key].status === 'available') {
          availableTokens.push(key)
        }
      }
      return availableTokens
    },

    async getExchangeSwapInfo (
      fromCurrency: string,
      toCurrency: string
    ): Promise<{
      rate: number,
      nativeMax: string,
      nativeMin: string,
      minerFee: string
    }> {
      const pair = `${fromCurrency}_${toCurrency}`
      const json = await api.get(`/marketinfo/${pair}`)

      const currencyInfos = ai.props.state.currency.infos
      const tokenInfos = ai.props.state.currency.customTokens
      const multiplierFrom = getCurrencyMultiplier(
        currencyInfos,
        tokenInfos,
        fromCurrency
      )
      const multiplierTo = getCurrencyMultiplier(
        currencyInfos,
        tokenInfos,
        toCurrency
      )
      const swapInfo = {
        rate: json.rate,
        minerFee: bns.mul(json.minerFee.toString(), multiplierTo),
        nativeMax: bns.mul(json.limit, multiplierFrom),
        nativeMin: bns.mul(json.minimum, multiplierFrom)
      }
      return swapInfo
    },

    async getSwapAddress (
      fromCurrency: string,
      toCurrency: string,
      addressFrom: string,
      addressTo: string
    ): Promise<ShapeshiftReply> {
      if (!apiKey) throw new Error('No Shapeshift API key provided')

      const body = {
        withdrawal: addressTo,
        pair: `${fromCurrency}_${toCurrency}`,
        returnAddress: addressFrom,
        apiKey
      }

      const replyJson: ShapeshiftReply = api.post('/shift', body)
      return replyJson
    }
  }
}
