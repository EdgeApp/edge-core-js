// @flow

import { combinePixies } from 'redux-pixies'

import type { ContextOutput } from './context/context-pixie.js'
import context from './context/context-pixie.js'
import type { CurrencyOutput } from './currency/currency-pixie.js'
import currency from './currency/currency-pixie.js'
import type { ExchangeOutput } from './exchange/exchange-pixie.js'
import exchange from './exchange/exchange-pixie.js'
import type { ScryptOutput } from './scrypt/scrypt-pixie.js'
import scrypt from './scrypt/scrypt-pixie.js'

// The top-level pixie output structure:
export type RootOutput = {
  +context: ContextOutput,
  +currency: CurrencyOutput,
  +exchange: ExchangeOutput,
  +scrypt: ScryptOutput
}

export const rootPixie = combinePixies({
  context,
  currency,
  exchange,
  scrypt
})
