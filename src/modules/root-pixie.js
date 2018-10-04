// @flow

import { combinePixies } from 'redux-pixies'

import accounts, { type AccountOutput } from './account/account-pixie.js'
import context, { type ContextOutput } from './context/context-pixie.js'
import currency, { type CurrencyOutput } from './currency/currency-pixie.js'
import exchange, { type ExchangeOutput } from './exchange/exchange-pixie.js'
import scrypt, { type ScryptOutput } from './scrypt/scrypt-pixie.js'

// The top-level pixie output structure:
export type RootOutput = {
  +accounts: { [accountId: string]: AccountOutput },
  +context: ContextOutput,
  +currency: CurrencyOutput,
  +exchange: ExchangeOutput,
  +scrypt: ScryptOutput
}

export const rootPixie = combinePixies({
  accounts,
  context,
  currency,
  exchange,
  scrypt
})
