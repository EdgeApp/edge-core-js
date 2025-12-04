import { expect } from 'chai'
import { describe, it } from 'mocha'

import { isEmptyMetadata } from '../../../../src/core/currency/wallet/metadata'

describe('metadata helpers', function () {
  describe('isEmptyMetadata', function () {
    it('returns true for empty metadata', function () {
      expect(isEmptyMetadata({})).equals(true)
      expect(isEmptyMetadata({ exchangeAmount: {} })).equals(true)
      expect(isEmptyMetadata({ name: '' })).equals(true)
      expect(isEmptyMetadata({ notes: '' })).equals(true)
      expect(isEmptyMetadata({ category: '' })).equals(true)
      expect(
        isEmptyMetadata({
          name: '',
          notes: '',
          category: '',
          exchangeAmount: {}
        })
      ).equals(true)
    })

    it('returns false for metadata with name', function () {
      expect(isEmptyMetadata({ name: 'Test' })).equals(false)
    })

    it('returns false for metadata with notes', function () {
      expect(isEmptyMetadata({ notes: 'Some notes' })).equals(false)
    })

    it('returns false for metadata with category', function () {
      expect(isEmptyMetadata({ category: 'expense:Food' })).equals(false)
    })

    it('returns false for metadata with bizId', function () {
      expect(isEmptyMetadata({ bizId: 123 })).equals(false)
    })

    it('returns false for metadata with exchangeAmount', function () {
      expect(isEmptyMetadata({ exchangeAmount: { 'iso:USD': 10.5 } })).equals(
        false
      )
    })

    it('returns false for metadata with multiple fields', function () {
      expect(
        isEmptyMetadata({
          name: 'Test',
          notes: 'Some notes',
          category: 'expense:Food',
          bizId: 123,
          exchangeAmount: { 'iso:USD': 10.5 }
        })
      ).equals(false)
    })
  })
})
