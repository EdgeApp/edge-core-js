// @flow

import { type Cleaner } from 'cleaners'
import { base64 } from 'rfc4648'

import { asOtpErrorPayload, asPasswordErrorPayload } from './server-cleaners.js'
import type { EdgeSwapInfo } from './types.js'

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

type InsufficientFundsErrorOpts = {
  // The currency we need more of:
  currencyCode?: string,
  // If we don't have enough funds for a token send:
  networkFee?: string
}

/**
 * Trying to spend more money than the wallet contains.
 */
export class InsufficientFundsError extends Error {
  name: string
  +currencyCode: string | void
  +networkFee: string | void

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
  +loginId: string | void
  +reason: 'ip' | 'otp'
  +resetDate: Date | void
  +resetToken: string | void
  +voucherId: string | void
  +voucherAuth: string | void // base64, to avoid a breaking change
  +voucherActivates: Date | void

  constructor(resultsJson: mixed, message: string = 'Invalid OTP token') {
    super(message)
    this.name = 'OtpError'
    this.reason = 'otp'

    try {
      const clean = asOtpErrorPayload(resultsJson)

      // This should usually be present:
      if (clean.login_id != null) {
        this.loginId = clean.login_id
      }

      // Use this to request an OTP reset (if enabled):
      if (clean.otp_reset_auth != null) {
        this.resetToken = clean.otp_reset_auth
      }

      // We might also get a different reason:
      if (clean.reason === 'ip') this.reason = 'ip'

      // Set if an OTP reset has already been requested:
      if (clean.otp_timeout_date != null) {
        this.resetDate = new Date(clean.otp_timeout_date)
      }

      // We might also get a login voucher:
      if (clean.voucher_activates != null) {
        this.voucherActivates = clean.voucher_activates
      }
      if (clean.voucher_auth != null) {
        this.voucherAuth = base64.stringify(clean.voucher_auth)
      }
      if (clean.voucher_id != null) this.voucherId = clean.voucher_id
    } catch (e) {}
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
  +wait: number | void // seconds

  constructor(resultsJson: mixed, message: string = 'Invalid password') {
    super(message)
    this.name = 'PasswordError'

    try {
      const clean = asPasswordErrorPayload(resultsJson)
      this.wait = clean.wait_seconds
    } catch (e) {}
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
 * @param nativeMax the maximum supported amount, in the "from" currency.
 */
export class SwapAboveLimitError extends Error {
  name: string
  +pluginId: string
  +nativeMax: string

  constructor(swapInfo: EdgeSwapInfo, nativeMax: string) {
    super('Amount is too high')
    this.name = 'SwapAboveLimitError'
    this.pluginId = swapInfo.pluginId
    this.nativeMax = nativeMax
  }
}

/**
 * Trying to swap an amount that is either too low or too high.
 * @param nativeMin the minimum supported amount, in the "from" currency.
 */
export class SwapBelowLimitError extends Error {
  name: string
  +pluginId: string
  +nativeMin: string

  constructor(swapInfo: EdgeSwapInfo, nativeMin: string) {
    super('Amount is too low')
    this.name = 'SwapBelowLimitError'
    this.pluginId = swapInfo.pluginId
    this.nativeMin = nativeMin
  }
}

/**
 * The swap plugin does not support this currency pair.
 */
export class SwapCurrencyError extends Error {
  name: string
  +pluginId: string
  +fromCurrency: string
  +toCurrency: string

  constructor(
    swapInfo: EdgeSwapInfo,
    fromCurrency: string,
    toCurrency: string
  ) {
    super(
      `${swapInfo.displayName} does not support ${fromCurrency} to ${toCurrency}`
    )
    this.name = 'SwapCurrencyError'
    this.pluginId = swapInfo.pluginId
    this.fromCurrency = fromCurrency
    this.toCurrency = toCurrency
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
  +pluginId: string
  +reason: SwapPermissionReason | void

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

function asMaybeError<T>(name: string): Cleaner<T | void> {
  return function asError(raw) {
    if (raw instanceof Error && raw.name === name) {
      const typeHack: any = raw
      return typeHack
    }
  }
}

export const asMaybeDustSpendError: Cleaner<DustSpendError | void> = asMaybeError(
  'DustSpendError'
)
export const asMaybeInsufficientFundsError: Cleaner<InsufficientFundsError | void> = asMaybeError(
  'InsufficientFundsError'
)
export const asMaybeNetworkError: Cleaner<NetworkError | void> = asMaybeError(
  'NetworkError'
)
export const asMaybeNoAmountSpecifiedError: Cleaner<NoAmountSpecifiedError | void> = asMaybeError(
  'NoAmountSpecifiedError'
)
export const asMaybeObsoleteApiError: Cleaner<ObsoleteApiError | void> = asMaybeError(
  'ObsoleteApiError'
)
export const asMaybeOtpError: Cleaner<OtpError | void> = asMaybeError(
  'OtpError'
)
export const asMaybePasswordError: Cleaner<PasswordError | void> = asMaybeError(
  'PasswordError'
)
export const asMaybePendingFundsError: Cleaner<PendingFundsError | void> = asMaybeError(
  'PendingFundsError'
)
export const asMaybeSameCurrencyError: Cleaner<SameCurrencyError | void> = asMaybeError(
  'SameCurrencyError'
)
export const asMaybeSpendToSelfError: Cleaner<SpendToSelfError | void> = asMaybeError(
  'SpendToSelfError'
)
export const asMaybeSwapAboveLimitError: Cleaner<SwapAboveLimitError | void> = asMaybeError(
  'SwapAboveLimitError'
)
export const asMaybeSwapBelowLimitError: Cleaner<SwapBelowLimitError | void> = asMaybeError(
  'SwapBelowLimitError'
)
export const asMaybeSwapCurrencyError: Cleaner<SwapCurrencyError | void> = asMaybeError(
  'SwapCurrencyError'
)
export const asMaybeSwapPermissionError: Cleaner<SwapPermissionError | void> = asMaybeError(
  'SwapPermissionError'
)
export const asMaybeUsernameError: Cleaner<UsernameError | void> = asMaybeError(
  'UsernameError'
)
