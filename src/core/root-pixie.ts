import { SyncClient } from 'edge-sync-client'
import { Dispatch } from 'redux'
import { combinePixies, PixieInput, TamePixie } from 'redux-pixies'

import { EdgeIo, EdgeLog } from '../types/types'
import { AccountOutput, accounts } from './account/account-pixie'
import { RootAction } from './actions'
import { context, ContextOutput } from './context/context-pixie'
import { currency, CurrencyOutput } from './currency/currency-pixie'
import { exchange } from './exchange/exchange-pixie'
import { LogBackend } from './log/log'
import { RootState } from './root-reducer'
import { scrypt, ScryptOutput } from './scrypt/scrypt-pixie'

// The top-level pixie output structure:
export interface RootOutput {
  readonly accounts: { [accountId: string]: AccountOutput }
  readonly context: ContextOutput
  readonly currency: CurrencyOutput
  readonly scrypt: ScryptOutput
}

// Props passed to the root pixie:
export interface RootProps {
  readonly close: () => void
  readonly dispatch: Dispatch<RootAction>
  readonly io: EdgeIo
  readonly log: EdgeLog
  readonly logBackend: LogBackend
  readonly onError: (error: Error) => unknown
  readonly output: RootOutput
  readonly state: RootState
  readonly syncClient: SyncClient
}

export type ApiInput = PixieInput<RootProps>

/**
 * Downstream pixies take props that extend from `RootProps`,
 * so this casts those back down if necessary.
 */
export const toApiInput = (input: PixieInput<any>): ApiInput => input

export const rootPixie: TamePixie<RootProps> = combinePixies({
  accounts,
  context,
  currency,
  exchange,
  scrypt
})
