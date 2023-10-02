import { Cleaner } from 'cleaners'
import { HttpHeaders, HttpResponse } from 'serverlet'

import { EdgeVoucherDump } from '../../types/fake-types'
import {
  wasLoginResponseBody,
  wasOtpErrorPayload,
  wasPasswordErrorPayload
} from '../../types/server-cleaners'
import { DbLogin } from './fake-db'

interface LoginStatusCode {
  code: number
  httpStatus: number
  message: string
}

export const statusCodes = {
  success: {
    code: 0,
    httpStatus: 200,
    message: 'Success'
  },
  error: {
    code: 1,
    httpStatus: 503,
    message: 'Error'
  },
  accountExists: {
    code: 2,
    httpStatus: 401,
    message: 'Account already exists'
  },
  noAccount: {
    code: 3,
    httpStatus: 401,
    message: 'No account'
  },
  invalidPassword: {
    code: 4,
    httpStatus: 401,
    message: 'Invalid Password'
  },
  invalidAnswers: {
    code: 5,
    httpStatus: 401,
    message: 'Invalid Answers'
  },
  invalidApiKey: {
    code: 6,
    httpStatus: 401,
    message: 'Invalid API Key'
  },
  // pinThrottled: {code: 7, httpStatus: , message: 401, 'Pin Throttled'}
  invalidOtp: {
    code: 8,
    httpStatus: 401,
    message: 'Invalid OTP'
  },
  conflict: {
    code: 10,
    httpStatus: 409,
    message: 'Conflicting change'
  },
  obsolete: {
    code: 1000,
    httpStatus: 410,
    message: 'Obsolete API'
  },

  // Variants of the "success" status code:
  created: {
    code: 0,
    httpStatus: 201,
    message: 'Account created'
  },

  // Variants of the "error" status code:
  invalidRequest: {
    code: 1,
    httpStatus: 401,
    message: 'Invalid request'
  },
  notFound: {
    code: 1,
    httpStatus: 404,
    message: 'Not found'
  },

  // Variants of the "noAccount" status code:
  noLobby: {
    code: 3,
    httpStatus: 404,
    message: 'Not found'
  },

  // Variants of the "conflict" error code:
  invalidAppId: {
    code: 10,
    httpStatus: 401,
    message: 'A login with the same appId already exists'
  }
}

export function cleanRequest<T>(
  cleaner: Cleaner<T>,
  raw: unknown
): [T | undefined, HttpResponse] {
  try {
    const clean = cleaner(raw)
    return [clean, { status: 200 }]
  } catch (error) {
    return [
      undefined,
      statusResponse(
        statusCodes.invalidRequest,
        `Invalid request: ${String(error)}`
      )
    ]
  }
}

/**
 * Construct an HttpResponse object with a JSON body.
 */
export function jsonResponse(
  body: unknown,
  opts: { status?: number; headers?: HttpHeaders } = {}
): HttpResponse {
  const { status = 200, headers = {} } = opts
  return {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  }
}

/**
 * A generic success or failure response.
 */
export function statusResponse(
  statusCode: LoginStatusCode = statusCodes.success,
  message: string = statusCode.message
): HttpResponse {
  const { code, httpStatus } = statusCode
  const body = wasLoginResponseBody({
    status_code: code,
    message
  })
  return jsonResponse(body, { status: httpStatus })
}

/**
 * A success response, with payload.
 */
export function payloadResponse(
  payload: unknown,
  statusCode: LoginStatusCode = statusCodes.success,
  message: string = statusCode.message
): HttpResponse {
  const { code, httpStatus } = statusCode
  const body = wasLoginResponseBody({
    status_code: code,
    message,
    results: payload
  })
  return jsonResponse(body, { status: httpStatus })
}

/**
 * An OTP failure response.
 */
export function otpErrorResponse(
  login: DbLogin,
  opts: {
    reason?: 'ip' | 'otp'
    voucher?: EdgeVoucherDump
  } = {}
): HttpResponse {
  const { reason = 'otp', voucher } = opts
  return payloadResponse(
    wasOtpErrorPayload({
      login_id: login.loginId,
      otp_reset_auth: login.otpResetAuth,
      otp_timeout_date: login.otpResetDate,
      reason,
      voucher_auth: voucher?.voucherAuth,
      voucher_activates: voucher?.activates,
      voucher_id: voucher?.voucherId
    }),
    statusCodes.invalidOtp
  )
}

/**
 * A password failure, with timeout.
 */
export function passwordErrorResponse(wait: number): HttpResponse {
  return payloadResponse(
    wasPasswordErrorPayload({
      wait_seconds: wait
    }),
    statusCodes.invalidPassword
  )
}
