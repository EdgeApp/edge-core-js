// @flow

import {
  type EdgeFetchFunction,
  type EdgeFetchOptions,
  type EdgeFetchResponse
} from '../../types/types.js'

type FakeRequest = {
  body: Object | null,
  method: string,
  path: string
}

export class FakeResponse {
  body: string
  status: number
  ok: boolean

  constructor(body: string = '', opts: { status?: number } = {}) {
    this.body = body
    this.status = opts.status || 200
    this.ok = this.status >= 200 && this.status < 300
  }

  json() {
    try {
      return Promise.resolve(JSON.parse(this.body))
    } catch (e) {
      return Promise.reject(e)
    }
  }

  text() {
    return Promise.resolve(this.body)
  }
}

// The db is passed as `this`.
type Handler = (req: FakeRequest) => FakeResponse | void

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
function findRoute(method, path) {
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
  db: Object
): EdgeFetchFunction & { offline: boolean } {
  function fetch(
    uri: string,
    opts: EdgeFetchOptions = {}
  ): Promise<EdgeFetchResponse> {
    try {
      if (out.offline) throw new Error('Fake network error')

      const req: FakeRequest = {
        method: opts.method || 'GET',
        body: typeof opts.body === 'string' ? JSON.parse(opts.body) : null,
        path: uri.replace(new RegExp('https?://[^/]*'), '')
      }

      const handlers = findRoute(req.method, req.path)
      for (const handler of handlers) {
        const out = handler.call(db, req)
        if (out != null) {
          return Promise.resolve(out)
        }
      }
      const body = {
        status_code: 1,
        message: `Unknown API endpoint ${req.path}`
      }
      return Promise.resolve(
        new FakeResponse(JSON.stringify(body), { status: 404 })
      )
    } catch (e) {
      return Promise.reject(e)
    }
  }

  const out = Object.assign(fetch, { offline: false })
  return out
}
