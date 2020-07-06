// @flow

import { type Disklet } from 'disklet'

import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFetchOptions,
  type EdgeNativeIo,
  type EdgeOnLog,
  type EdgeScryptFunction
} from '../../types/types.js'
import { type HttpResponse } from '../../util/http/http-types.js'

export type ClientIo = {
  +disklet: Disklet,
  +onLog: EdgeOnLog,

  +entropy: string, // base64
  +scrypt: EdgeScryptFunction,

  // Networking:
  fetchCors(url: string, opts: EdgeFetchOptions): Promise<HttpResponse>
}

export type WorkerApi = {
  makeEdgeContext(
    nativeIo: EdgeNativeIo,
    opts: EdgeContextOptions
  ): Promise<EdgeContext>,

  makeFakeEdgeWorld(
    nativeIo: EdgeNativeIo,
    users?: EdgeFakeUser[]
  ): Promise<EdgeFakeWorld>
}
