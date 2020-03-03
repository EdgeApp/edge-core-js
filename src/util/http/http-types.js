// @flow

export type HttpHeaders = {
  [header: string]: string
}

export type HttpResponse = {
  status?: number,
  headers?: HttpHeaders,
  body?: string | ArrayBuffer
}

export type HttpRequest = {
  +method: string,
  +path: string,
  +version: string, // 'HTTP/1.1'
  +headers: $ReadOnly<HttpHeaders>
}

// A server is just an async function that takes some type of request
// and returns an HttpResponse:
export type Server<Request> = (request: Request) => Promise<HttpResponse>
