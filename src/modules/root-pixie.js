// @flow

import { type Dispatch } from 'redux'
import { type PixieInput, type TamePixie, combinePixies } from 'redux-pixies'

import { type EdgeCorePluginFactory, type EdgeIo } from '../types/types.js'
import { type AccountOutput, accounts } from './account/account-pixie.js'
import { type RootAction } from './actions.js'
import { type ContextOutput, context } from './context/context-pixie.js'
import { type CurrencyOutput, currency } from './currency/currency-pixie.js'
import { type ExchangeOutput, exchange } from './exchange/exchange-pixie.js'
import { type RootState } from './root-reducer.js'
import { type ScryptOutput, scrypt } from './scrypt/scrypt-pixie.js'

// The top-level pixie output structure:
export type RootOutput = {
  +accounts: { [accountId: string]: AccountOutput },
  +context: ContextOutput,
  +currency: CurrencyOutput,
  +exchange: ExchangeOutput,
  +scrypt: ScryptOutput
}

// Props passed to the root pixie:
export type RootProps = {
  +dispatch: Dispatch<RootAction>,
  +io: EdgeIo,
  +onError: (e: Error) => mixed,
  +onExchangeUpdate: () => mixed,
  +output: RootOutput,
  +plugins: Array<EdgeCorePluginFactory>,
  +shapeshiftKey: string | void,
  +changellyInit?: { apiKey: string, secret: string } | void,
  +changeNowKey?: string | void,
  +state: RootState
}

export type ApiInput = PixieInput<RootProps>

export const rootPixie: TamePixie<RootProps> = combinePixies({
  accounts,
  context,
  currency,
  exchange,
  scrypt
})
