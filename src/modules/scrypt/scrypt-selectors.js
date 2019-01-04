// @flow

import { utf8 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { type JsonSnrp } from './scrypt-pixie.js'

/**
 * Computes an SNRP value.
 */
export function makeSnrp (
  ai: ApiInput,
  targetMs: number = 2000
): Promise<JsonSnrp> {
  return ai.props.output.scrypt.makeSnrp(targetMs)
}

/**
 * Performs an scrypt derivation.
 */
export function scrypt (
  ai: ApiInput,
  data: Uint8Array | string,
  snrp: JsonSnrp
) {
  if (typeof data === 'string') data = utf8.parse(data)

  return ai.props.output.scrypt.timeScrypt(data, snrp).then(value => value.hash)
}

export const userIdSnrp: JsonSnrp = {
  salt_hex: 'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b',
  n: 16384,
  r: 1,
  p: 1
}
