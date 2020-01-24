// @flow

import {
  type EdgeFetchFunction,
  type EdgeFetchOptions,
  type EdgeFetchResponse
} from '../../types/types.js'
import { makeFetchResponse } from '../../util/http/http-to-fetch.js'
import { type HttpResponse } from '../../util/http/http-types.js'
import { type DbLogin, type FakeDb } from './fake-db.js'
import { statusCodes, statusResponse } from './fake-responses.js'

export type FakeRequest = {
  body: any,
  method: string,
  path: string,
  login: DbLogin // Maybe added by middleware
}

// The db is passed as `this`.
type Handler = (req: FakeRequest) => HttpResponse | void

const routes: Array<{ method: string, path: RegExp, handler: Handler }> = []

/**
 * Wires one or more handlers into the routing table.
 */
export function addRoute(method: string, path: string, ...handlers: Handler[]) {
  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i]
    routes.push({
      method,
      path: new RegExp(`^${path}$`),
      handler
    })
  }
}

/**
 * Finds all matching handlers in the routing table.
 */
function findRoute(method, path): Handler[] {
  return routes
    .filter(route => {
      return route.method === method && route.path.test(path)
    })
    .map(route => route.handler)
}

/**
 * Returns a fake fetch function bound to a fake DB instance.
 */
export function makeFakeFetch(
  db: FakeDb
): EdgeFetchFunction & { offline: boolean } {
  function fetch(
    uri: string,
    opts: EdgeFetchOptions = {}
  ): Promise<EdgeFetchResponse> {
    try {
      if (out.offline) throw new Error('Fake network error')

      const noLogin: any = undefined
      const req: FakeRequest = {
        method: opts.method || 'GET',
        body: typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined,
        path: uri.replace(new RegExp('https?://[^/]*'), ''),
        login: noLogin
      }

      const handlers = findRoute(req.method, req.path)
      for (const handler of handlers) {
        const response = handler.call(db, req)
        if (response != null) {
          return Promise.resolve(makeFetchResponse(response))
        }
      }
      const response = statusResponse(
        statusCodes.notFound,
        `Unknown API endpoint ${req.path}`
      )
      return Promise.resolve(makeFetchResponse(response))
    } catch (e) {
      return Promise.reject(e)
    }
  }

  const out = Object.assign(fetch, { offline: false })
  return out
}
