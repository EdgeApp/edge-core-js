import { close, shareData } from 'yaob'

import {
  EdgePasswordRules,
  EdgeStreamTransactionOptions,
  EdgeTransaction,
  EdgeWalletInfoFull
} from './types/types'

export interface InternalWalletStream {
  next: () => Promise<{
    done: boolean
    value: EdgeTransaction[]
  }>
}

export interface InternalWalletMethods {
  $internalStreamTransactions: (
    opts: EdgeStreamTransactionOptions
  ) => Promise<InternalWalletStream>
}

/**
 * Client-side EdgeAccount methods.
 */
export class AccountSync {
  readonly allKeys!: EdgeWalletInfoFull[]

  getFirstWalletInfo(type: string): EdgeWalletInfoFull | undefined {
    return this.allKeys.find(info => info.type === type)
  }

  getWalletInfo(id: string): EdgeWalletInfoFull | undefined {
    return this.allKeys.find(info => info.id === id)
  }

  listWalletIds(): string[] {
    return this.allKeys.map(info => info.id)
  }
}
shareData(AccountSync.prototype, 'AccountSync')

/**
 * Verifies that a password meets our suggested rules.
 */
export function checkPasswordRules(password: string): EdgePasswordRules {
  const tooShort = password.length < 10
  const noNumber = !/[0-9]/.test(password)
  const noLowerCase = !/[a-z]/.test(password)
  const noUpperCase = !/[A-Z]/.test(password)

  // Quick & dirty password strength estimation:
  const charset =
    (/[0-9]/.test(password) ? 10 : 0) +
    (/[A-Z]/.test(password) ? 26 : 0) +
    (/[a-z]/.test(password) ? 26 : 0) +
    (/[^0-9A-Za-z]/.test(password) ? 30 : 0)
  const secondsToCrack = Math.pow(charset, password.length) / 1e6

  return {
    secondsToCrack,
    tooShort,
    noNumber,
    noLowerCase,
    noUpperCase,
    passed:
      password.length >= 16 ||
      !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}
shareData({ checkPasswordRules })

/**
 * Normalizes a username, and checks for invalid characters.
 * TODO: Support a wider character range via Unicode normalization.
 */
export function fixUsername(username: string): string {
  const out = username
    .toLowerCase()
    .replace(/[ \f\r\n\t\v]+/g, ' ')
    .replace(/ $/, '')
    .replace(/^ /, '')

  for (let i = 0; i < out.length; ++i) {
    const c = out.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) {
      throw new Error('Bad characters in username')
    }
  }
  return out
}
shareData({ fixUsername })

/**
 * Synchronously constructs a transaction stream.
 * This method creates a secret internal stream,
 * which differs slightly from the AsyncIterableIterator protocol
 * because of YAOB limitations.
 * It then wraps the internal stream object with the correct API.
 */
export function streamTransactions(
  this: InternalWalletMethods,
  opts: EdgeStreamTransactionOptions
): AsyncIterableIterator<EdgeTransaction[]> {
  let stream: InternalWalletStream | undefined
  let streamClosed = false

  const out: AsyncIterableIterator<EdgeTransaction[]> = {
    next: async () => {
      if (stream == null) stream = await this.$internalStreamTransactions(opts)
      if (!streamClosed) {
        const out = await stream.next()
        if (!out.done) return out
        close(stream)
        streamClosed = true
      }
      return { done: true, value: undefined }
    },

    /**
     * Closes the iterator early if the client doesn't want all the results.
     * This is necessary to prevent memory leaks over the bridge.
     */
    return: async () => {
      if (stream != null && !streamClosed) {
        close(stream)
        streamClosed = true
      }
      return { done: true, value: undefined }
    },

    [Symbol.asyncIterator]: () => out
  }
  return out
}
shareData({ streamTransactions }, 'CurrencyWalletSync')
