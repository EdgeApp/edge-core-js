// @flow

import { type Disklet } from 'disklet'

import {
  type EdgeConsole,
  type EdgeContext,
  type EdgeContextOptions,
  type EdgeFakeUser,
  type EdgeFakeWorld,
  type EdgeNativeIo,
  type EdgeScryptFunction
} from '../../types/types.js'

export type ClientIo = {
  console: EdgeConsole,
  disklet: Disklet,

  entropy: string, // base64
  scrypt: EdgeScryptFunction
}

export type WorkerApi = {
  makeEdgeContext(
    nativeIo: EdgeNativeIo,
    opts: EdgeContextOptions
  ): Promise<EdgeContext>,

  makeFakeEdgeWorld(
    nativeIo: EdgeNativeIo,
    users?: Array<EdgeFakeUser>
  ): Promise<EdgeFakeWorld>
}
