import { EdgeSnrp } from '../../types/server-types'
import { utf8 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'

/**
 * Computes an SNRP value.
 */
export function makeSnrp(
  ai: ApiInput,
  targetMs: number = 2000
): Promise<EdgeSnrp> {
  return ai.props.output.scrypt.makeSnrp(targetMs)
}

/**
 * Performs an scrypt derivation.
 */
export async function scrypt(
  ai: ApiInput,
  data: Uint8Array | string,
  snrp: EdgeSnrp
): Promise<Uint8Array> {
  if (typeof data === 'string') data = utf8.parse(data)

  const value = await ai.props.output.scrypt.timeScrypt(data, snrp)
  return value.hash
}

export const userIdSnrp: EdgeSnrp = {
  salt_hex: Uint8Array.from([
    0xb5,
    0x86,
    0x5f,
    0xfb,
    0x9f,
    0xa7,
    0xb3,
    0xbf,
    0xe4,
    0xb2,
    0x38,
    0x4d,
    0x47,
    0xce,
    0x83,
    0x1e,
    0xe2,
    0x2a,
    0x4a,
    0x9d,
    0x5c,
    0x34,
    0xc7,
    0xef,
    0x7d,
    0x21,
    0x46,
    0x7c,
    0xc7,
    0x58,
    0xf8,
    0x1b
  ]),
  n: 16384,
  r: 1,
  p: 1
}
