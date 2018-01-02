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
      const reply = await io.fetch(`${API_PREFIX}${path}`)
      return reply.json()
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

    async getExchangeSwapInfo (
      fromCurrency: string,
      toCurrency: string
    ): Promise<{
      rate: number,
      nativeMax: string,
      nativeMin: string
    }> {
      const pair = `${fromCurrency}_${toCurrency}`
      const json = await api.get(`/marketinfo/${pair}`)

      const currencyInfos = ai.props.state.currency.infos
      const multiplier = getCurrencyMultiplier(currencyInfos, fromCurrency)
      const swapInfo = {
        rate: json.rate,
        nativeMax: bns.mulf(json.limit, multiplier),
        nativeMin: bns.mulf(json.minimum, multiplier)
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
