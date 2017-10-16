// @flow
import type { FixedIo } from '../../io/fixIo.js'

import ENV from '../../../env'

export type ExchangeSwapRate = {
  pair: string,
  rate: string,
}

const API_PREFIX = 'https://shapeshift.io'

export default function makeShapeshiftApi (io: FixedIo) {
  const api = {
    async get (path) {
      const reply = await io.fetch(`${API_PREFIX}${path}`)
      return reply.json()
    },
    async post (path, body) {
      const reply = await io.fetch(`${API_PREFIX}${path}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      return reply.json()
    }
  }

  return {
    async getExchangeSwapRate (fromCurrency: string, toCurrency: string) {
      const pair = `${fromCurrency}_${toCurrency}`
      return api.get(`/rate/${pair}`)
    },

    async getSwapAddress (fromCurrency: string, toCurrency: string, addressFrom: string, addressTo: string) {
      const body = {
        withdrawal: addressTo,
        pair: `${fromCurrency}_${toCurrency}`,
        returnAddress: addressFrom,
        apiKey: ENV.SHAPESIFT_PUBLIC_API_KEY
      }
      return api.post('/shift', body)
    }
  }
}
