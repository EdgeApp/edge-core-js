// @flow

import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeCorePlugins,
  type EdgeCorePluginsInit,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFakeWorldOptions,
  type EdgeIo,
  type EdgeLoginMessages,
  type EdgeLogSettings,
  type EdgeNativeIo,
  type EdgeOnLog
} from './types.js'

const hack: any = null

export const addEdgeCorePlugins = (plugins: EdgeCorePlugins): void => hack
export const lockEdgeCorePlugins = (): void => hack
export const closeEdge = (): void => hack
export const makeFakeIo = (): EdgeIo => hack

/**
 * Initializes the Edge core library,
 * automatically selecting the appropriate platform.
 */
export const makeEdgeContext = (
  opts: EdgeContextOptions
): Promise<EdgeContext> => hack

export const makeFakeEdgeWorld = (
  users?: EdgeFakeUser[],
  opts?: EdgeFakeWorldOptions
): Promise<EdgeFakeWorld> => hack

/**
 * React Native component for creating an EdgeContext.
 */
export const MakeEdgeContext = (props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (context: EdgeContext) => mixed,

  // Deprecated. Just pass options like `apiKey` as normal props:
  options?: EdgeContextOptions,

  // EdgeContextOptions:
  apiKey?: string,
  appId?: string,
  authServer?: string,
  deviceDescription?: string,
  hideKeys?: boolean,
  logSettings?: $Shape<EdgeLogSettings>,
  onLog?: EdgeOnLog,
  plugins?: EdgeCorePluginsInit
}): any => hack // React element

/**
 * React Native component for creating an EdgeFakeWorld for testing.
 */
export const MakeFakeEdgeWorld = (props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (context: EdgeFakeWorld) => mixed,
  onLog?: EdgeOnLog,
  users: EdgeFakeUser[]
}): any => hack // React element

/**
 * React Native function for getting login alerts without a context:
 */
export const fetchLoginMessages = (apiKey: string): EdgeLoginMessages => hack

// System-specific io exports:
export const makeBrowserIo = (): EdgeIo => hack
export const makeNodeIo = (path: string): EdgeIo => hack
