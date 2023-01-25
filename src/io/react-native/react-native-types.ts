import * as React from 'react'
import { HttpResponse } from 'serverlet'

import { LogBackend } from '../../core/log/log'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeFetchOptions,
  EdgeNativeIo
} from '../../types/types'

export interface ClientIo {
  // Networking:
  fetchCors: (url: string, opts: EdgeFetchOptions) => Promise<HttpResponse>
}

export interface WorkerApi {
  makeEdgeContext: (
    clientIo: ClientIo,
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    pluginUris: string[],
    opts: EdgeContextOptions
  ) => Promise<EdgeContext>

  makeFakeEdgeWorld: (
    clientIo: ClientIo,
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    pluginUris: string[],
    users?: EdgeFakeUser[]
  ) => Promise<EdgeFakeWorld>
}

export interface EdgeCoreMessageEvent {
  nativeEvent: { message: string }
}

export interface EdgeCoreScriptError {
  nativeEvent: { source: string }
}

export interface EdgeCoreWebViewProps {
  allowDebugging?: boolean
  source: string | null
  style?: any
  onMessage?: (event: EdgeCoreMessageEvent) => void
  onScriptError?: (event: EdgeCoreScriptError) => void
}
export type EdgeCoreWebView = React.ComponentType<EdgeCoreWebViewProps>
export type EdgeCoreWebViewRef = React.Component<EdgeCoreWebViewProps>
