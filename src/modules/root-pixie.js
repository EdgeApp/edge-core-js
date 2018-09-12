// @flow

import { combinePixies } from 'redux-pixies'

import type { AccountOutput } from './account/account-pixie.js'
import accounts from './account/account-pixie.js'
import type { ContextOutput } from './context/context-pixie.js'
import context from './context/context-pixie.js'
import type { CurrencyOutput } from './currency/currency-pixie.js'
import currency from './currency/currency-pixie.js'
import type { ExchangeOutput } from './exchange/exchange-pixie.js'
import exchange from './exchange/exchange-pixie.js'
import type { LoginOutput } from './login/login-pixie.js'
import login from './login/login-pixie.js'
import type { ScryptOutput } from './scrypt/scrypt-pixie.js'
import scrypt from './scrypt/scrypt-pixie.js'

// The top-level pixie output structure:
export type RootOutput = {
  +accounts: { [accountId: string]: AccountOutput },
  +context: ContextOutput,
  +currency: CurrencyOutput,
  +exchange: ExchangeOutput,
  +login: LoginOutput,
  +scrypt: ScryptOutput
}

export const rootPixie = combinePixies({
  accounts,
  context,
  currency,
  exchange,
  login,
  scrypt
})
