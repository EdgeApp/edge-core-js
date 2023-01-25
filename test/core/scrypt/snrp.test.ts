import { expect } from 'chai'
import { describe, it } from 'mocha'

import { calcSnrpForTarget } from '../../../src/core/scrypt/scrypt-pixie'

describe('SNRP calculation', function () {
  const salt = new Uint8Array(32)

  it('basic functionality', function () {
    // Typical desktop with JS + V8:
    expect(calcSnrpForTarget(salt, 32, 2000)).deep.equals({
      salt_hex: salt,
      n: 131072,
      r: 8,
      p: 14
    })

    // Insane speeds:
    expect(calcSnrpForTarget(salt, 1, 2000)).deep.equals({
      salt_hex: salt,
      n: 131072,
      r: 8,
      p: 64
    })

    // Infinity:
    expect(calcSnrpForTarget(salt, 0, 2000)).deep.equals({
      salt_hex: salt,
      n: 131072,
      r: 8,
      p: 64
    })
  })
})
