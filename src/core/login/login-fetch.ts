import { asMaybe, asObject, asString, Cleaner } from 'cleaners'
import { base64 } from 'rfc4648'

import { ApiSignerError, asMaybeApiSignerError } from '../../types/error'
import {
  asChallengeErrorPayload,
  asLoginResponseBody,
  wasLoginRequestBody
} from '../../types/server-cleaners'
import { LoginRequestBody } from '../../types/server-types'
import {
  ChallengeError,
  EdgeApiSignature,
  EdgeApiSigner,
  EdgeFetchOptions,
  EdgeFetchResponse,
  NetworkError,
  ObsoleteApiError,
  OtpError,
  PasswordError,
  UsernameError
} from '../../types/types'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { timeout } from '../../util/promise'
import { ApiInput } from '../root-pixie'

const asEdgeApiSignature: Cleaner<EdgeApiSignature> = asObject({
  apiKey: asString,
  signature: asString
})

function isUsableSignerKey(apiKey: string, signature: string): boolean {
  return apiKey !== '' && !/\s/.test(apiKey) && signature !== ''
}

/**
 * Build the login-server Authorization header from apiSigner, apiSecret, or
 * the legacy Token fallback.
 */
export async function makeLoginAuthorization(opts: {
  apiSigner?: EdgeApiSigner
  apiKey?: string
  apiSecret?: Uint8Array | null
  requestText: string
}): Promise<string> {
  const { apiSigner, apiKey, apiSecret, requestText } = opts
  if (apiSigner != null) {
    try {
      const signed = asEdgeApiSignature(
        await timeout(apiSigner.signMessage(requestText), 30000)
      )
      if (!isUsableSignerKey(signed.apiKey, signed.signature)) {
        throw new Error('apiSigner returned an unusable apiKey or signature')
      }
      return `HMAC ${signed.apiKey} ${signed.signature}`
    } catch (error: unknown) {
      throw new ApiSignerError(
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  if (apiSecret != null) {
    const hash = hmacSha256(utf8.parse(requestText), apiSecret)
    return `HMAC ${apiKey ?? ''} ${base64.stringify(hash)}`
  }
  return `Token ${apiKey ?? ''}`
}

export function parseReply(json: unknown): unknown {
  const clean = asLoginResponseBody(json)

  switch (clean.status_code) {
    case 0: // Success
      return clean.results

    case 2: // Account exists
      throw new UsernameError('Account already exists on server')

    case 3: // Account does not exist
      throw new UsernameError('Account does not exist on server')

    case 4: // Invalid password
    case 5: // Invalid answers
      throw new PasswordError(clean.results)

    case 6: // Invalid API key
      throw new Error('Invalid API key')

    case 8: // Invalid OTP
      throw new OtpError(clean.results)

    case 1000: // Endpoint obsolete
      throw new ObsoleteApiError()

    case 1: // Error
    case 7: // Pin expired
    case 9: // Invalid voucher
    case 10: // Conflicting change
    case 11: // Rate limiting
    default: {
      const results = asMaybe(asChallengeErrorPayload)(clean.results)
      if (results != null) {
        throw new ChallengeError(results)
      }
      throw new Error(`Server error: ${clean.message}`)
    }
  }
}

/**
 * Picks a random login server and makes a request.
 *
 * We don't use the normal async waterfall,
 * since we never want these requests to happen in parallel.
 * The first server needs to fully fail before we can try again,
 * or we risk having document update conflicts, duplicated keys,
 * redundant login notifications, or other corruption.
 */
export async function loginFetch(
  ai: ApiInput,
  method: string,
  path: string,
  body?: LoginRequestBody
): Promise<unknown> {
  const { loginServers } = ai.props.state.login

  // This will be out of range, but the modulo brings it back:
  const startIndex = Math.floor(Math.random() * 255)

  let response: EdgeFetchResponse | undefined
  let lastError: unknown = new Error('No login servers available')
  for (let i = 0; i < loginServers.length; ++i) {
    try {
      const index = (startIndex + i) % loginServers.length
      response = await loginFetchInner(
        ai,
        loginServers[index],
        method,
        path,
        body
      )
      break
    } catch (error) {
      if (asMaybeApiSignerError(error) != null) throw error
      lastError = error
    }
  }
  if (response == null) throw lastError

  const { status } = response
  const json = await response.json().catch(() => {
    throw new Error(`Invalid reply JSON, HTTP status ${status}`)
  })
  return parseReply(json)
}

export async function loginFetchInner(
  ai: ApiInput,
  serverUri: string,
  method: string,
  path: string,
  body?: LoginRequestBody
): Promise<EdgeFetchResponse> {
  const { state, io, log, apiSigner } = ai.props
  const { apiKey, apiSecret, attestationToken } = state.login

  const bodyText =
    method === 'GET' || body == null
      ? undefined
      : JSON.stringify(wasLoginRequestBody(body))

  // Authorization:
  const requestText = `${method}\n/api${path}\n${bodyText ?? ''}`
  const authorization = await makeLoginAuthorization({
    apiSigner,
    apiKey,
    apiSecret,
    requestText
  })

  const opts: EdgeFetchOptions = {
    body: bodyText,
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization,
      ...(attestationToken != null
        ? { 'x-attestation-token': attestationToken }
        : {})
    },
    corsBypass: 'never'
  }

  const start = Date.now()
  const fullUri = `${serverUri}/api${path}`
  return await timeout(io.fetch(fullUri, opts), 30000).then(
    response => {
      // Log the results:
      const time = Date.now() - start
      log(`${method} ${fullUri} returned ${response.status} in ${time}ms`)

      if (response.status === 409) {
        log.crash(`Login API conflict error`, {
          path
        })
      }

      return response
    },
    networkError => {
      const time = Date.now() - start
      log.error(
        `${method} ${fullUri} failed in ${time}ms, ${String(networkError)}`
      )
      throw new NetworkError(`Could not reach the auth server: ${path}`)
    }
  )
}
