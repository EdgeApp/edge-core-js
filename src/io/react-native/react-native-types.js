// @flow

import { type HttpResponse } from 'serverlet'

import { type LogBackend } from '../../core/log/log.js'
import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFetchOptions,
  type EdgeNativeIo
} from '../../types/types.js'

export type ClientIo = {
  // Networking:
  fetchCors(url: string, opts: EdgeFetchOptions): Promise<HttpResponse>
}

export type WorkerApi = {
  makeEdgeContext(
    clientIo: ClientIo,
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    pluginUris: string[],
    opts: EdgeContextOptions
  ): Promise<EdgeContext>,

  makeFakeEdgeWorld(
    clientIo: ClientIo,
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    pluginUris: string[],
    users?: EdgeFakeUser[]
  ): Promise<EdgeFakeWorld>
}

export type EdgeCoreMessageEvent = {
  nativeEvent: { message: string }
}

export type EdgeCoreScriptError = {
  nativeEvent: { source: string }
}

declare export class EdgeCoreWebView
  extends
    React$Component<{|
      allowDebugging?: boolean,
      source: string | null,
      style?: any,
      onMessage?: (event: EdgeCoreMessageEvent) => void,
      onScriptError?: (event: EdgeCoreScriptError) => void
    |}> {}
