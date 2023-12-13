import type { Cleaner } from 'cleaners'
import { asMaybe } from 'cleaners'
import { base64 } from 'rfc4648'

import { asOtpErrorPayload, asPasswordErrorPayload } from './server-cleaners'
import type { ChallengeErrorPayload } from './server-types'
import type { EdgeSwapInfo, EdgeSwapRequest, EdgeTokenId } from './types'

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
 * Thrown when the login server requires a CAPTCHA.
 *
 * After showing the WebView with the challengeUri,
 * pass the challengeId to the login method
 * (such as loginWithPassword) to complete the login.
 *
 * The challengeUri web page will signal that it is done by navigating
 * to a new location that ends with either /success or /failure,
 * such as https://login.edge.app/challenge/success
 * The login UI can use this as a signal to close the WebView.
 */
export class ChallengeError extends Error {
  name: string
  challengeId: string
  challengeUri: string

  constructor(
    resultsJson: ChallengeErrorPayload,
    message: string = 'Login requires a CAPTCHA'
  ) {
    super(message)
    this.name = 'ChallengeError'
    this.challengeId = resultsJson.challengeId
    this.challengeUri = resultsJson.challengeUri
  }
}

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
  tokenId: EdgeTokenId
  // If we don't have enough funds for a token send:
  networkFee?: string
}

/**
 * Trying to spend more money than the wallet contains.
 */
export class InsufficientFundsError extends Error {
  name: string
  readonly tokenId: EdgeTokenId
  readonly networkFee: string | undefined

  // Passing a string is deprecated
  constructor(opts: InsufficientFundsErrorOpts) {
    const { tokenId = null, networkFee } = opts ?? {}
    super(`Insufficient ${tokenId ?? 'funds'}`)
    this.tokenId = tokenId
    this.networkFee = networkFee
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
  readonly fromTokenId: EdgeTokenId
  readonly toTokenId: EdgeTokenId

  constructor(swapInfo: EdgeSwapInfo, request: EdgeSwapRequest) {
    const { fromWallet, toWallet, fromTokenId, toTokenId } = request
    const fromPluginId = fromWallet.currencyConfig.currencyInfo.pluginId
    const toPluginId = toWallet.currencyConfig.currencyInfo.pluginId

    const fromString = `${fromPluginId}:${String(fromTokenId)}`
    const toString = `${toPluginId}:${String(toTokenId)}`

    super(
      `${swapInfo.displayName} does not support ${fromString} to ${toString}`
    )
    this.name = 'SwapCurrencyError'
    this.pluginId = swapInfo.pluginId
    this.fromTokenId = fromTokenId ?? null
    this.toTokenId = toTokenId ?? null
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

export const asMaybeChallengeError =
  asMaybeError<ChallengeError>('ChallengeError')
export const asMaybeDustSpendError =
  asMaybeError<DustSpendError>('DustSpendError')
export const asMaybeInsufficientFundsError =
  asMaybeError<InsufficientFundsError>('InsufficientFundsError')
export const asMaybeNetworkError = asMaybeError<NetworkError>('NetworkError')
export const asMaybeNoAmountSpecifiedError =
  asMaybeError<NoAmountSpecifiedError>('NoAmountSpecifiedError')
export const asMaybeObsoleteApiError =
  asMaybeError<ObsoleteApiError>('ObsoleteApiError')
export const asMaybeOtpError = asMaybeError<OtpError>('OtpError')
export const asMaybePasswordError = asMaybeError<PasswordError>('PasswordError')
export const asMaybePendingFundsError =
  asMaybeError<PendingFundsError>('PendingFundsError')
export const asMaybeSameCurrencyError =
  asMaybeError<SameCurrencyError>('SameCurrencyError')
export const asMaybeSpendToSelfError =
  asMaybeError<SpendToSelfError>('SpendToSelfError')
export const asMaybeSwapAboveLimitError = asMaybeError<SwapAboveLimitError>(
  'SwapAboveLimitError'
)
export const asMaybeSwapBelowLimitError = asMaybeError<SwapBelowLimitError>(
  'SwapBelowLimitError'
)
export const asMaybeSwapCurrencyError =
  asMaybeError<SwapCurrencyError>('SwapCurrencyError')
export const asMaybeSwapPermissionError = asMaybeError<SwapPermissionError>(
  'SwapPermissionError'
)
export const asMaybeUsernameError = asMaybeError<UsernameError>('UsernameError')
