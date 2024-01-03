import { expect } from 'chai'
import { asDate, uncleaner } from 'cleaners'
import { describe, it } from 'mocha'

import { asMap } from '../../src/util/asMap'

describe('asMap', function () {
  const asDates = asMap(asDate)

  it('cleans JSON data', function () {
    const clean = asDates({
      btc: '2009-01-03',
      usa: '1776-07-04'
    })

    expect(Array.from(clean.entries())).deep.equals([
      ['btc', new Date('2009-01-03')],
      ['usa', new Date('1776-07-04')]
    ])
  })

  it('restores JSON data', function () {
    const wasDates = uncleaner(asDates)

    const clean = new Map([
      ['btc', new Date('2009-01-03')],
      ['usa', new Date('1776-07-04')]
    ])

    expect(wasDates(clean)).deep.equals({
      btc: '2009-01-03T00:00:00.000Z',
      usa: '1776-07-04T00:00:00.000Z'
    })
  })
})
