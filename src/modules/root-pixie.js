// @flow

import { combinePixies } from 'redux-pixies'

import { type AccountOutput, accounts } from './account/account-pixie.js'
import { type ContextOutput, context } from './context/context-pixie.js'
import { type CurrencyOutput, currency } from './currency/currency-pixie.js'
import { type ExchangeOutput, exchange } from './exchange/exchange-pixie.js'
import { type ScryptOutput, scrypt } from './scrypt/scrypt-pixie.js'

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
