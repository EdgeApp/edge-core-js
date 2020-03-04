// @flow

import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeCorePlugins,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeIo,
  type EdgeLoginMessages,
  type EdgeNativeIo
} from './types.js'

const hack: any = null

export const addEdgeCorePlugins = (plugins: EdgeCorePlugins): mixed => hack
export const lockEdgeCorePlugins = (): mixed => hack
export const closeEdge = (): mixed => hack
export const makeFakeIo = (): EdgeIo => hack

/**
 * Initializes the Edge core library,
 * automatically selecting the appropriate platform.
 */
export const makeEdgeContext = (
  opts: EdgeContextOptions
): Promise<EdgeContext> => hack

export const makeFakeEdgeWorld = (
  users?: EdgeFakeUser[]
): Promise<EdgeFakeWorld> => hack

/**
 * React Native component for creating an EdgeContext.
 */
export const MakeEdgeContext = (props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (context: EdgeContext) => mixed,
  options: EdgeContextOptions
}): any => hack // React element

/**
 * React Native component for creating an EdgeFakeWorld for testing.
 */
export const MakeFakeEdgeWorld = (props: {
  debug?: boolean,
  nativeIo?: EdgeNativeIo,
  onError?: (e: any) => mixed,
  onLoad: (context: EdgeFakeWorld) => mixed,
  users: EdgeFakeUser[]
}): any => hack // React element

/**
 * React Native function for getting login alerts without a context:
 */
export const fetchLoginMessages = (apiKey: string): EdgeLoginMessages => hack

// System-specific io exports:
export const makeBrowserIo = (): EdgeIo => hack
export const makeNodeIo = (path: string): EdgeIo => hack
