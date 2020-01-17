// @flow

import { type HttpResponse, type Server } from './http-types.js'

/**
 * An HTTP endpoint, which knows how to handle one or more HTTP methods.
 * Returns `405 - Method Not Allowed` errors for unknown methods,
 * and adds a default `OPTIONS` handler if needed.
 */
export function pickMethod<T: { +method: string }>(methods: {
  [method: string]: Server<T>
}): Server<T> {
  // Uppercase the method names:
  const cleanMethods: { [method: string]: Server<T> } = {}
  for (const name of Object.keys(methods)) {
    cleanMethods[name.toUpperCase()] = methods[name]
  }

  // Add a default OPTIONS handler:
  if (cleanMethods.OPTIONS == null) {
    cleanMethods.OPTIONS = () => {
      return Promise.resolve({ status: 200, headers: optionsHeaders })
    }
  }
  const optionsHeaders = {
    'content-length': '0',
    allow: Object.keys(cleanMethods).join(', ')
  }

  return request => {
    const handler = cleanMethods[request.method]
    if (handler != null) return handler(request)
    return Promise.resolve({ status: 405, headers: optionsHeaders })
  }
}

/**
 * A router, which picks a server based on a URL.
 */
export function pickPath<T: { +path: string }>(routes: {
  [path: string]: Server<T>
}): Server<T> {
  // Convert the routes to regular expressions:
  const table: Array<{ regexp: RegExp, server: Server<T> }> = []
  for (const route of Object.keys(routes)) {
    table.push({
      regexp: new RegExp(`^${route}$`),
      server: routes[route]
    })
  }

  return request => {
    for (const { regexp, server } of table) {
      if (regexp.test(request.path)) return server(request)
    }
    return Promise.resolve({ status: 404 })
  }
}

/**
 * Tries servers until it either reaches the end,
 * or finds one that doesn't return a 404 status.
 */
export function pickServer<T>(...servers: Server<T>[]): Server<T> {
  const last = servers.length - 1

  function tryServer(i: number, request: T): Promise<HttpResponse> {
    return servers[i](request).then(response =>
      response.status === 404 && i < last ? tryServer(i + 1, request) : response
    )
  }
  return request => tryServer(0, request)
}
