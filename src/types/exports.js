// @flow

import {
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeCorePlugins,
  type EdgeCorePluginsInit,
  type EdgeCrashReporter,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeFakeWorldOptions,
  type EdgeIo,
  type EdgeLoginMessages,
  type EdgeLogSettings,
  type EdgeNativeIo,
  type EdgeOnLog,
  type Partial // @ts-delete
} from './types.js'

export * from './types.js'

declare export function addEdgeCorePlugins(plugins: EdgeCorePlugins): void
declare export function lockEdgeCorePlugins(): void
declare export function closeEdge(): void
declare export function makeFakeIo(): EdgeIo

// System-specific io exports:
declare export function makeBrowserIo(): EdgeIo
declare export function makeNodeIo(path: string): EdgeIo

/**
 * Initializes the Edge core library,
 * automatically selecting the appropriate platform.
 */
declare export function makeEdgeContext(
  opts: EdgeContextOptions
): Promise<EdgeContext>

declare export function makeFakeEdgeWorld(
  users?: EdgeFakeUser[],
  opts?: EdgeFakeWorldOptions
): Promise<EdgeFakeWorld>

// ---------------------------------------------------------------------
// react-native
// ---------------------------------------------------------------------

interface CommonProps {
  debug?: boolean;
  nativeIo?: EdgeNativeIo;
  onError?: (e: any) => mixed;
}

export interface EdgeContextProps extends CommonProps {
  onLoad: (context: EdgeContext) => mixed;

  // Deprecated. Just pass options like `apiKey` as normal props:
  options?: EdgeContextOptions;

  // EdgeContextOptions:
  apiKey?: string;
  appId?: string;
  authServer?: string;
  crashReporter?: EdgeCrashReporter;
  deviceDescription?: string;
  hideKeys?: boolean;
  logSettings?: Partial<EdgeLogSettings>;
  onLog?: EdgeOnLog;
  plugins?: EdgeCorePluginsInit;
}

export interface EdgeFakeWorldProps extends CommonProps {
  onLoad: (world: EdgeFakeWorld) => mixed;
  users?: EdgeFakeUser[];

  // EdgeFakeWorldOptions:
  crashReporter?: EdgeCrashReporter;
  onLog?: EdgeOnLog;
}

/**
 * React Native component for creating an EdgeContext.
 */
declare export var MakeEdgeContext: React$StatelessFunctionalComponent<EdgeContextProps>

/**
 * React Native component for creating an EdgeFakeWorld for testing.
 */
declare export var MakeFakeEdgeWorld: React$StatelessFunctionalComponent<EdgeFakeWorldProps>

/**
 * React Native function for getting login alerts without a context:
 */
declare export function fetchLoginMessages(apiKey: string): EdgeLoginMessages
