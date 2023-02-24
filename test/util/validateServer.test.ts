import { expect } from 'chai'
import { describe, it } from 'mocha'

import { validateServer } from '../../src/util/validateServer'

describe('validateServer', function () {
  it('accepts valid login server overrides', function () {
    for (const server of [
      'https://login.edge.app/app',
      'https://login2.edge.app/app',
      'https://login-test.edge.app',
      'https://login-test.edge.app/app',
      'https://edgetest.app',
      'https://login.edgetest.app',
      'http://localhost',
      'http://localhost/app',
      'https://localhost/app',
      'http://localhost:8080/app'
    ]) {
      validateServer(server)
    }
  })

  it('rejects invalid login server overrides', function () {
    for (const server of [
      'https://login.hacker.com/app',
      'https://login.not-edge.app/app',
      'https://edge.app:fun@hacker.com/app',
      'https://login.edgetes.app/app',
      'http://login.edge.app/app',
      'ftp://login.edge.app'
    ]) {
      expect(() => validateServer(server)).to.throw(
        'Only *.edge.app or localhost are valid login domain names'
      )
    }
  })
})
