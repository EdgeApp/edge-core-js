// @flow

export type HttpHeaders = {
  [header: string]: string
}

export type HttpResponse = {
  status?: number,
  headers?: HttpHeaders,
  body?: string | ArrayBuffer
}
