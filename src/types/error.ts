import { asMaybe, Cleaner } from 'cleaners'
import { base64 } from 'rfc4648'

import { asOtpErrorPayload, asPasswordErrorPayload } from './server-cleaners'
import { upgradeCurrencyCode } from './type-helpers'
import { EdgeSwapInfo, EdgeSwapRequest } from './types'

/*
 * These are errors the core knows about.
 *
 * The GUI should handle these errors in an "intelligent" way, such as by
 * displaying a localized error message or asking the user for more info.
 * All these errors have a `name` field, which the GUI can use to select
 * the appropriate response.
 *
 * Other errors are possible, of course, since the Javascript language
 * itself can generate exceptions. Those errors won't have a `type` field,
 * and the GUI should just show them with a stack trace & generic message,
 * since the program has basically crashed at that point.
 */

/**
 * Trying to spend an uneconomically small amount of money.
 */
export class DustSpendError extends Error {
  name: string

  constructor(message: string = 'Please send a larger amount') {
    super(message)
    this.name = 'DustSpendError'
  }
}

interface InsufficientFundsErrorOpts {
  // The currency we need more of:
  currencyCode?: string
  // If we don't have enough funds for a token send:
  networkFee?: string
}

/**
 * Trying to spend more money than the wallet contains.
 */
export class InsufficientFundsError extends Error {
  name: string
  readonly currencyCode: string | undefined
  readonly networkFee: string | undefined

  constructor(opts: string | InsufficientFundsErrorOpts = {}) {
    if (typeof opts === 'string') {
      // Some plugins pass a message instead of a currency code:
      if (opts.length > 5) {
        super(opts)
      } else {
        super(`Insufficient ${opts}`)
        this.currencyCode = opts
      }
    } else {
      const { currencyCode, networkFee } = opts
      super(`Insufficient ${currencyCode ?? 'funds'}`)
      this.currencyCode = currencyCode
      this.networkFee = networkFee
    }
    this.name = 'InsufficientFundsError'
  }
}

/**
 * Could not reach the server at all.
 */
export class NetworkError extends Error {
  name: string

  constructor(message: string = 'Cannot reach the network') {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * Attempting to create a MakeSpend without specifying an amount of currency to send
 */
export class NoAmountSpecifiedError extends Error {
  name: string

  constructor(message: string = 'Unable to create zero-amount transaction.') {
    super(message)
    this.name = 'NoAmountSpecifiedError'
  }
}

/**
 * The endpoint on the server is obsolete, and the app needs to be upgraded.
 */
export class ObsoleteApiError extends Error {
  name: string

  constructor(message: string = 'The application is too old. Please upgrade.') {
    super(message)
    this.name = 'ObsoleteApiError'
  }
}

/**
 * The OTP token was missing / incorrect.
 *
 * The error object should include a `resetToken` member,
 * which can be used to reset OTP protection on the account.
 *
 * The error object may include a `resetDate` member,
 * which indicates that an OTP reset is already pending,
 * and when it will complete.
 */
export class OtpError extends Error {
  name: string
  readonly loginId: string | undefined // base64, to avoid a breaking change
  readonly reason: 'ip' | 'otp'
  readonly resetDate: Date | undefined
  readonly resetToken: string | undefined
  readonly voucherId: string | undefined
  readonly voucherAuth: string | undefined // base64, to avoid a breaking change
  readonly voucherActivates: Date | undefined

  constructor(resultsJson: unknown, message: string = 'Invalid OTP token') {
    super(message)
    this.name = 'OtpError'
    this.reason = 'otp'

    const clean = asMaybe(asOtpErrorPayload)(resultsJson)
    if (clean == null) return

    if (clean.login_id != null) {
      this.loginId = base64.stringify(clean.login_id)
    }

    this.resetToken = clean.otp_reset_auth
    this.reason = clean.reason
    this.resetDate = clean.otp_timeout_date

    this.voucherActivates = clean.voucher_activates
    if (clean.voucher_auth != null) {
      this.voucherAuth = base64.stringify(clean.voucher_auth)
    }
    this.voucherId = clean.voucher_id
  }
}

/**
 * The provided authentication is incorrect.
 *
 * Reasons could include:
 * - Password login: wrong password
 * - PIN login: wrong PIN
 * - Recovery login: wrong answers
 *
 * The error object may include a `wait` member,
 * which is the number of seconds the user must wait before trying again.
 */
export class PasswordError extends Error {
  name: string
  readonly wait: number | undefined // seconds

  constructor(resultsJson: unknown, message: string = 'Invalid password') {
    super(message)
    this.name = 'PasswordError'

    const clean = asMaybe(asPasswordErrorPayload)(resultsJson)
    if (clean == null) return

    this.wait = clean.wait_seconds
  }
}

/**
 * Trying to spend funds that are not yet confirmed.
 */
export class PendingFundsError extends Error {
  name: string

  constructor(message: string = 'Not enough confirmed funds') {
    super(message)
    this.name = 'PendingFundsError'
  }
}

/**
 * Attempting to shape shift between two wallets of same currency.
 */
export class SameCurrencyError extends Error {
  name: string

  constructor(message: string = 'Wallets can not be the same currency') {
    super(message)
    this.name = 'SameCurrencyError'
  }
}

/**
 * Trying to spend to an address of the source wallet
 */
export class SpendToSelfError extends Error {
  name: string

  constructor(message: string = 'Spending to self') {
    super(message)
    this.name = 'SpendToSelfError'
  }
}

/**
 * Trying to swap an amount that is either too low or too high.
 * @param nativeMax the maximum supported amount, in the currency specified
 * by the direction (defaults to "from" currency)
 */
export class SwapAboveLimitError extends Error {
  name: string
  readonly pluginId: string
  readonly nativeMax: string
  readonly direction: 'from' | 'to'

  constructor(
    swapInfo: EdgeSwapInfo,
    nativeMax: string,
    direction: 'from' | 'to' = 'from'
  ) {
    super('Amount is too high')
    this.name = 'SwapAboveLimitError'
    this.pluginId = swapInfo.pluginId
    this.nativeMax = nativeMax
    this.direction = direction
  }
}

/**
 * Trying to swap an amount that is either too low or too high.
 * @param nativeMin the minimum supported amount, in the currency specified
 * by the direction (defaults to "from" currency)
 */
export class SwapBelowLimitError extends Error {
  name: string
  readonly pluginId: string
  readonly nativeMin: string
  readonly direction: 'from' | 'to'

  constructor(
    swapInfo: EdgeSwapInfo,
    nativeMin: string,
    direction: 'from' | 'to' = 'from'
  ) {
    super('Amount is too low')
    this.name = 'SwapBelowLimitError'
    this.pluginId = swapInfo.pluginId
    this.nativeMin = nativeMin
    this.direction = direction
  }
}

/**
 * The swap plugin does not support this currency pair.
 */
export class SwapCurrencyError extends Error {
  name: string
  readonly pluginId: string
  readonly fromCurrency: string
  readonly toCurrency: string
  readonly fromTokenId: string | undefined
  readonly toTokenId: string | undefined

  constructor(
    swapInfo: EdgeSwapInfo,
    // Passing currency codes is deprecated:
    request: string | EdgeSwapRequest,
    toCurrency?: string
  ) {
    // Backwards-compatible currency code extraction:
    if (typeof request === 'string') {
      toCurrency = toCurrency ?? 'unknown' // This keeps the types happy
      super(
        `${swapInfo.displayName} does not support ${request} to ${toCurrency}`
      )
      this.name = 'SwapCurrencyError'
      this.pluginId = swapInfo.pluginId
      this.fromCurrency = request
      this.toCurrency = toCurrency
    } else {
      const from = upgradeCurrencyCode({
        allTokens: request.fromWallet.currencyConfig.allTokens,
        currencyInfo: request.fromWallet.currencyInfo,
        currencyCode: request.fromCurrencyCode,
        tokenId: request.fromTokenId
      })
      const to = upgradeCurrencyCode({
        allTokens: request.toWallet.currencyConfig.allTokens,
        currencyInfo: request.toWallet.currencyInfo,
        currencyCode: request.toCurrencyCode,
        tokenId: request.toTokenId
      })

      const fromString: string =
        from.tokenId == null
          ? from.currencyCode
          : `${from.currencyCode} (${from.tokenId})`
      const toString: string =
        to.tokenId == null
          ? to.currencyCode
          : `${to.currencyCode} (${to.tokenId})`

      super(
        `${swapInfo.displayName} does not support ${fromString} to ${toString}`
      )
      this.name = 'SwapCurrencyError'
      this.pluginId = swapInfo.pluginId
      this.fromCurrency = from.currencyCode
      this.fromTokenId = from.tokenId
      this.toCurrency = to.currencyCode
      this.toTokenId = to.tokenId
    }
  }
}

type SwapPermissionReason =
  | 'geoRestriction'
  | 'noVerification'
  | 'needsActivation'

/**
 * The user is not allowed to swap these coins for some reason
 * (no KYC, restricted IP address, etc...).
 * @param reason A string giving the reason for the denial.
 * - 'geoRestriction': The IP address is in a restricted region
 * - 'noVerification': The user needs to provide KYC credentials
 * - 'needsActivation': The user needs to log into the service.
 */
export class SwapPermissionError extends Error {
  name: string
  readonly pluginId: string
  readonly reason: SwapPermissionReason | undefined

  constructor(swapInfo: EdgeSwapInfo, reason?: SwapPermissionReason) {
    if (reason != null) super(reason)
    else super('You are not allowed to make this trade')
    this.name = 'SwapPermissionError'
    this.pluginId = swapInfo.pluginId
    this.reason = reason
  }
}

/**
 * Cannot find a login with that id.
 *
 * Reasons could include:
 * - Password login: wrong username
 * - PIN login: wrong PIN key
 * - Recovery login: wrong username, or wrong recovery key
 */
export class UsernameError extends Error {
  name: string

  constructor(message: string = 'Invalid username') {
    super(message)
    this.name = 'UsernameError'
  }
}

function asMaybeError<T>(name: string): Cleaner<T | undefined> {
  return function asError(raw) {
    if (raw instanceof Error && raw.name === name) {
      const typeHack: any = raw
      return typeHack
    }
  }
}

export const asMaybeDustSpendError: Cleaner<
  DustSpendError | undefined
> = asMaybeError('DustSpendError')
export const asMaybeInsufficientFundsError: Cleaner<
  InsufficientFundsError | undefined
> = asMaybeError('InsufficientFundsError')
export const asMaybeNetworkError: Cleaner<
  NetworkError | undefined
> = asMaybeError('NetworkError')
export const asMaybeNoAmountSpecifiedError: Cleaner<
  NoAmountSpecifiedError | undefined
> = asMaybeError('NoAmountSpecifiedError')
export const asMaybeObsoleteApiError: Cleaner<
  ObsoleteApiError | undefined
> = asMaybeError('ObsoleteApiError')
export const asMaybeOtpError: Cleaner<OtpError | undefined> = asMaybeError(
  'OtpError'
)
export const asMaybePasswordError: Cleaner<
  PasswordError | undefined
> = asMaybeError('PasswordError')
export const asMaybePendingFundsError: Cleaner<
  PendingFundsError | undefined
> = asMaybeError('PendingFundsError')
export const asMaybeSameCurrencyError: Cleaner<
  SameCurrencyError | undefined
> = asMaybeError('SameCurrencyError')
export const asMaybeSpendToSelfError: Cleaner<
  SpendToSelfError | undefined
> = asMaybeError('SpendToSelfError')
export const asMaybeSwapAboveLimitError: Cleaner<
  SwapAboveLimitError | undefined
> = asMaybeError('SwapAboveLimitError')
export const asMaybeSwapBelowLimitError: Cleaner<
  SwapBelowLimitError | undefined
> = asMaybeError('SwapBelowLimitError')
export const asMaybeSwapCurrencyError: Cleaner<
  SwapCurrencyError | undefined
> = asMaybeError('SwapCurrencyError')
export const asMaybeSwapPermissionError: Cleaner<
  SwapPermissionError | undefined
> = asMaybeError('SwapPermissionError')
export const asMaybeUsernameError: Cleaner<
  UsernameError | undefined
> = asMaybeError('UsernameError')
