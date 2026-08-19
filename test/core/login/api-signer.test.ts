import { expect } from 'chai'
import { describe, it } from 'mocha'
import { base64 } from 'rfc4648'
import { bridgifyObject } from 'yaob'

import { makeLoginAuthorization } from '../../../src/core/login/login-fetch'
import { makeFakeEdgeWorld } from '../../../src/index'
import { asMaybeApiSignerError } from '../../../src/types/error'
import { EdgeApiSigner } from '../../../src/types/types'
import { hmacSha256 } from '../../../src/util/crypto/hashes'
import { utf8 } from '../../../src/util/encoding'
import { fakeUser } from '../../fake/fake-user'

const quiet = { onLog() {} }

describe('makeLoginAuthorization', function () {
  const requestText = 'POST\n/api/v2/login\n{"userId":"1"}'

  it('uses apiSigner over apiSecret', async function () {
    const header = await makeLoginAuthorization({
      apiKey: 'from-opts',
      apiSecret: utf8.parse('secret-bytes'),
      requestText,
      apiSigner: {
        async signMessage() {
          return { apiKey: 'from-signer', signature: 'sig-from-signer' }
        }
      }
    })
    expect(header).equals('HMAC from-signer sig-from-signer')
  })

  it('HMACs with apiSecret when apiSigner is absent', async function () {
    const secret = utf8.parse('unit-test-secret')
    const header = await makeLoginAuthorization({
      apiKey: 'token-key',
      apiSecret: secret,
      requestText
    })
    const expected = base64.stringify(
      hmacSha256(utf8.parse(requestText), secret)
    )
    expect(header).equals(`HMAC token-key ${expected}`)
  })

  it('sends Token when neither signer nor secret is present', async function () {
    const header = await makeLoginAuthorization({
      apiKey: 'token-key',
      requestText
    })
    expect(header).equals('Token token-key')
  })

  it('rejects a whitespace apiKey from the signer', async function () {
    try {
      await makeLoginAuthorization({
        requestText,
        apiSigner: {
          async signMessage() {
            return { apiKey: 'not a key', signature: 'sig' }
          }
        }
      })
      expect.fail('expected ApiSignerError')
    } catch (error: unknown) {
      // Assert on `name`, not the prototype chain: the production build runs
      // babel-plugin-transform-fake-error-class, which rewrites the class into
      // a factory so `instanceof` is always false there. Mocha runs via
      // sucrase, which skips that plugin, so an instanceof assertion would
      // pass here while the shipped guard silently failed.
      expect(asMaybeApiSignerError(error)).not.equals(undefined)
    }
  })
})

describe('apiSigner', function () {
  it('prefers apiSigner over apiSecret for login-server requests', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const messages: string[] = []

    // YAOB requires bridgifyObject for callbacks passed into makeEdgeContext:
    const apiSigner: EdgeApiSigner = bridgifyObject({
      async signMessage(message: string) {
        messages.push(message)
        return {
          apiKey: 'from-signer',
          signature: 'sig-from-signer'
        }
      }
    })

    const context = await world.makeEdgeContext({
      apiKey: 'from-opts',
      apiSecret: utf8.parse('secret-bytes'),
      apiSigner,
      appId: ''
    })

    await context.usernameAvailable('brand-new-user-xyz')

    expect(messages.length).to.be.greaterThan(0)
    const message = messages[0]
    expect(message.startsWith('POST\n/api/')).equals(true)

    // Prove apiSecret would have produced a different signature:
    const secretHash = base64.stringify(
      hmacSha256(utf8.parse(message), utf8.parse('secret-bytes'))
    )
    expect(secretHash).to.not.equal('sig-from-signer')

    await context.close()
    await world.close()
  })

  it('falls back to apiSecret when apiSigner is absent', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      apiKey: 'token-key',
      apiSecret: utf8.parse('unit-test-secret'),
      appId: ''
    })
    const available = await context.usernameAvailable('another-new-user')
    expect(available).equals(true)
    await context.close()
    await world.close()
  })
})
