// @flow

import {
  type EdgeFetchHeaders,
  type EdgeFetchResponse
} from '../../types/types.js'
import { utf8 } from '../encoding.js'
import { type HttpHeaders, type HttpResponse } from './http-types.js'

/**
 * Turns a simple response into a fetch-style Response object.
 */
export function makeFetchResponse(response: HttpResponse): EdgeFetchResponse {
  const { body = '', headers = {}, status = 200 } = response
  // Use a promise wrapper to make all exceptions async:
  const bodyPromise = Promise.resolve(body)

  const out: EdgeFetchResponse = {
    headers: makeFetchHeaders(headers),
    ok: status >= 200 && status < 300,
    status,

    arrayBuffer(): Promise<ArrayBuffer> {
      return bodyPromise.then(body =>
        typeof body === 'string' ? utf8.parse(body).buffer : body
      )
    },

    json() {
      return out.text().then(text => JSON.parse(text))
    },

    text() {
      return bodyPromise.then(body =>
        typeof body === 'string' ? body : utf8.stringify(new Uint8Array(body))
      )
    }
  }
  return out
}

/**
 * Turns a simple key-value map into a fetch-style Headers object.
 */
function makeFetchHeaders(headers: HttpHeaders): EdgeFetchHeaders {
  const out: EdgeFetchHeaders = {
    forEach(callback, thisArg) {
      Object.keys(headers).forEach(name =>
        callback.call(thisArg, headers[name], name, out)
      )
    },

    get(name) {
      if (!out.has(name)) return null
      return headers[name]
    },

    has(name) {
      return Object.prototype.hasOwnProperty.call(headers, name)
    }
  }
  return out
}
