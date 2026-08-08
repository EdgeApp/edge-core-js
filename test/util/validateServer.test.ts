import { expect } from 'chai'
import { describe, it } from 'mocha'

import { validateServer } from '../../src/util/validateServer'

const rejectMessage =
  'Only *.edge.app, localhost, or private LAN addresses (http/ws) are valid login domain names'

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
      'http://localhost:8080/app',
      'http://127.0.0.1:8008',
      'http://192.168.1.50:3123',
      'http://10.0.0.5',
      'ws://172.16.0.1',
      'http://172.31.255.255'
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
      'ftp://login.edge.app',
      'http://172.32.0.1',
      'http://172.15.255.255',
      'http://8.8.8.8',
      'http://11.0.0.1',
      'https://192.168.1.50',
      'https://127.0.0.1',
      'wss://127.0.0.1',
      // Prefix-only DNS names must not match the private-IP allowlist:
      'http://10.evil.com',
      'http://192.168.evil.com',
      'http://172.16.evil.com'
    ]) {
      expect(() => validateServer(server)).to.throw(rejectMessage)
    }
  })
})
