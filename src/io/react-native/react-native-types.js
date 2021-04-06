// @flow

import { type Disklet } from 'disklet'

import { type LogBackend } from '../../core/log/log.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFetchOptions,
  type EdgeNativeIo,
  type EdgeScryptFunction
} from '../../types/types.js'
import { type HttpResponse } from '../../util/http/http-types.js'

export type ClientIo = {
  +disklet: Disklet,

  +entropy: string, // base64
  +scrypt: EdgeScryptFunction,

  // Networking:
  fetchCors(url: string, opts: EdgeFetchOptions): Promise<HttpResponse>
}

export type WorkerApi = {
  makeEdgeContext(
    clientIo: ClientIo,
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    opts: EdgeContextOptions
  ): Promise<EdgeContext>,

  makeFakeEdgeWorld(
    clientIo: ClientIo,
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    users?: EdgeFakeUser[]
  ): Promise<EdgeFakeWorld>
}
