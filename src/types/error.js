/*
 * These are errors the core knows about.
 *
 * The GUI should handle these errors in an "intelligent" way, such as by
 * displaying a localized error message or asking the user for more info.
 * All these errors have a `type` field, which the GUI can use to select
 * the appropriate response.
 *
 * Other errors are possible, of course, since the Javascript language
 * itself can generate exceptions. Those errors won't have a `type` field,
 * and the GUI should just show them with a stack trace & generic message,
 * since the program has basically crashed at that point.
 */

export const errorNames = {
  DustSpendError: 'DustSpendError',
  InsufficientFundsError: 'InsufficientFundsError',
  SpendToSelfError: 'SpendToSelfError',
  NetworkError: 'NetworkError',
  ObsoleteApiError: 'ObsoleteApiError',
  OtpError: 'OtpError',
  PasswordError: 'PasswordError',
  PendingFundsError: 'PendingFundsError',
  SameCurrencyError: 'SameCurrencyError',
  SwapAboveLimitError: 'SwapAboveLimitError',
  SwapBelowLimitError: 'SwapBelowLimitError',
  SwapCurrencyError: 'SwapCurrencyError',
  SwapPermissionError: 'SwapPermissionError',
  UsernameError: 'UsernameError',
  NoAmountSpecifiedError: 'NoAmountSpecifiedError'
}

/**
 * Trying to spend an uneconomically small amount of money.
 */
export function DustSpendError(message = 'Please send a larger amount') {
  const e = new Error(message)
  e.name = errorNames.DustSpendError
  return e
}

/**
 * Trying to spend more money than the wallet contains.
 */
export function InsufficientFundsError(currencyCode) {
  let message
  if (currencyCode == null) {
    message = 'Insufficient funds'
  } else if (currencyCode.length > 5) {
    // Some plugins pass a message instead of a currency code:
    message = currencyCode
    currencyCode = undefined
  } else {
    message = `Insufficient ${currencyCode}`
  }

  const e = new Error(message)
  e.name = errorNames.InsufficientFundsError
  if (currencyCode != null) e.currencyCode = currencyCode
  return e
}

/**
 * Trying to spend to an address of the source wallet
 */
export function SpendToSelfError(message = 'Spending to self') {
  const e = new Error(message)
  e.name = errorNames.SpendToSelfError
  return e
}

/**
 * Attempting to create a MakeSpend without specifying an amount of currency to send
 */

export function NoAmountSpecifiedError(
  message = 'Unable to create zero-amount transaction.'
) {
  const e = new Error(message)
  e.name = errorNames.NoAmountSpecifiedError
  return e
}

/**
 * Could not reach the server at all.
 */
export function NetworkError(message = 'Cannot reach the network') {
  const e = new Error(message)
  e.name = e.type = errorNames.NetworkError
  return e
}

/**
 * The endpoint on the server is obsolete, and the app needs to be upgraded.
 */
export function ObsoleteApiError(
  message = 'The application is too old. Please upgrade.'
) {
  const e = new Error(message)
  e.name = e.type = errorNames.ObsoleteApiError
  return e
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
export function OtpError(resultsJson = {}, message = 'Invalid OTP token') {
  const e = new Error(message)
  e.name = e.type = errorNames.OtpError
  e.resetToken = resultsJson.otp_reset_auth
  if (resultsJson.otp_timeout_date != null) {
    // The server returns dates as ISO 8601 formatted strings:
    e.resetDate = new Date(resultsJson.otp_timeout_date)
  }
  return e
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
export function PasswordError(resultsJson = {}, message = 'Invalid password') {
  const e = new Error(message)
  e.name = e.type = errorNames.PasswordError
  e.wait = resultsJson.wait_seconds
  return e
}

/**
 * Trying to spend funds that are not yet confirmed.
 */
export function PendingFundsError(message = 'Not enough confirmed funds') {
  const e = new Error(message)
  e.name = errorNames.PendingFundsError
  return e
}

/**
 * Attempting to shape shift between two wallets of same currency.
 */
export function SameCurrencyError(
  message = 'Wallets can not be the same currency'
) {
  const e = new Error(message)
  e.name = errorNames.SameCurrencyError
  return e
}

/**
 * Trying to swap an amount that is either too low or too high.
 * @param nativeMax the maximum supported amount, in the "from" currency.
 */
export function SwapAboveLimitError(swapInfo, nativeMax) {
  const e = new Error('Amount is too high')
  e.name = errorNames.SwapAboveLimitError
  e.pluginName = swapInfo.pluginName
  e.nativeMax = nativeMax
  return e
}

/**
 * Trying to swap an amount that is either too low or too high.
 * @param nativeMin the minimum supported amount, in the "from" currency.
 */
export function SwapBelowLimitError(swapInfo, nativeMin) {
  const e = new Error('Amount is too low')
  e.name = errorNames.SwapBelowLimitError
  e.pluginName = swapInfo.pluginName
  e.nativeMin = nativeMin
  return e
}

/**
 * The swap plugin does not support this currency pair.
 */
export function SwapCurrencyError(swapInfo, fromCurrency, toCurrency) {
  const e = new Error(
    `${swapInfo.displayName} does not support ${fromCurrency} to ${toCurrency}`
  )
  e.name = errorNames.SwapCurrencyError
  e.pluginName = swapInfo.pluginName
  e.fromCurrency = fromCurrency
  e.toCurrency = toCurrency
  return e
}

/**
 * The user is not allowed to swap these coins for some reason
 * (no KYC, restricted IP address, etc...).
 * @param reason A string giving the reason for the denial.
 * - 'geoRestriction': The IP address is in a restricted region
 * - 'noVerification': The user needs to provide KYC credentials
 * - 'needsActivation': The user needs to log into the service.
 */
export function SwapPermissionError(swapInfo, reason) {
  const e = new Error(reason || 'You are not allowed to make this trade')
  e.name = errorNames.SwapPermissionError
  e.pluginName = swapInfo.pluginName
  e.reason = reason
  return e
}

/**
 * Cannot find a login with that id.
 *
 * Reasons could include:
 * - Password login: wrong username
 * - PIN login: wrong PIN key
 * - Recovery login: wrong username, or wrong recovery key
 */
export function UsernameError(message = 'Invalid username') {
  const e = new Error(message)
  e.name = e.type = errorNames.UsernameError
  return e
}
