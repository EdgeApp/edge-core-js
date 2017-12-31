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

/**
 * Trying to spend an uneconomically small amount of money.
 */
export function DustSpendError (message = 'Please send a larger amount') {
  const e = new Error(message)
  e.name = DustSpendError.name
  return e
}

/**
 * Trying to spend more money than the wallet contains.
 */
export function InsufficientFundsError (message = 'Insufficient funds') {
  const e = new Error(message)
  e.name = InsufficientFundsError.name
  return e
}

/**
 * Could not reach the server at all.
 */
export function NetworkError (message = 'Cannot reach the network') {
  const e = new Error(message)
  e.name = e.type = NetworkError.name
  return e
}
NetworkError.type = NetworkError.name

/**
 * The endpoint on the server is obsolete, and the app needs to be upgraded.
 */
export function ObsoleteApiError (
  message = 'The application is too old. Please upgrade.'
) {
  const e = new Error(message)
  e.name = e.type = ObsoleteApiError.name
  return e
}
ObsoleteApiError.type = ObsoleteApiError.name

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
export function OtpError (resultsJson = {}, message = 'Invalid OTP token') {
  const e = new Error(message)
  e.name = e.type = OtpError.name
  e.resetToken = resultsJson.otp_reset_auth
  if (resultsJson.otp_timeout_date != null) {
    // The server returns dates as ISO 8601 formatted strings:
    e.resetDate = new Date(resultsJson.otp_timeout_date)
  }
  return e
}
OtpError.type = OtpError.name

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
export function PasswordError (resultsJson = {}, message = 'Invalid password') {
  const e = new Error(message)
  e.name = e.type = PasswordError.name
  e.wait = resultsJson.wait_seconds
  return e
}
PasswordError.type = PasswordError.name

/**
 * Cannot find a login with that id.
 *
 * Reasons could include:
 * - Password login: wrong username
 * - PIN login: wrong PIN key
 * - Recovery login: wrong username, or wrong recovery key
 */
export function UsernameError (message = 'Invalid username') {
  const e = new Error(message)
  e.name = e.type = UsernameError.name
  return e
}
UsernameError.type = UsernameError.name
