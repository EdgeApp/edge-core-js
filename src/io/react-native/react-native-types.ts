import * as React from 'react'

import { LogBackend } from '../../core/log/log'
import {
  EdgeContext,
  EdgeContextOptions,
  EdgeFakeUser,
  EdgeFakeWorld,
  EdgeNativeIo
} from '../../types/types'

export interface WorkerApi {
  makeEdgeContext: (
    nativeIo: EdgeNativeIo,
    logBackend: LogBackend,
    pluginUris: string[],
    opts: EdgeContextOptions
  ) => Promise<EdgeContext>

  makeFakeEdgeWorld: (
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
export type EdgeCoreWebView = React.ComponentClass<EdgeCoreWebViewProps>
export type EdgeCoreWebViewRef = React.Component<EdgeCoreWebViewProps>

// Throttle YAOB updates
export const YAOB_THROTTLE_MS = 50
