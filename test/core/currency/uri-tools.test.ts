import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  linkToParsedUri,
  parsedUriToLink
} from '../../../src/core/currency/uri-tools'
import { EdgeParsedLink, EdgeParsedUri } from '../../../src/types/types'
import { fakeCurrencyInfo, fakeTokens } from '../../fake/fake-currency-plugin'

describe('uri tools', function () {
  it('converts a parsed uri into a link', async function () {
    const metadata = {
      name: 'Alice',
      notes: 'Pay request',
      gateway: true
    }
    const uriToken = {
      contractAddress: '0x1234',
      currencyCode: 'CSTM',
      currencyName: 'Custom Token',
      denominations: [{ multiplier: '1', name: 'CSTM' }],
      type: 'erc20'
    }
    const expireDate = new Date('2024-01-01T00:00:00Z')

    const uri: EdgeParsedUri = {
      currencyCode: 'TOKEN',
      publicAddress: 'fakeaddress',
      metadata,
      uniqueIdentifier: 'memo123',
      nativeAmount: '100',
      minNativeAmount: '50',
      expireDate,
      paymentProtocolUrl: 'https://example.com/pay',
      privateKeys: ['privkey'],
      token: uriToken,
      walletConnect: {
        uri: 'wc:abc',
        topic: 'topic'
      }
    }

    const link = parsedUriToLink(uri, fakeCurrencyInfo, fakeTokens)

    // Payment request:
    expect(link.pay?.publicAddress).equals('fakeaddress')
    expect(link.pay?.addressType).equals('publicAddress')
    expect(link.pay?.label).equals('Alice')
    expect(link.pay?.message).equals('Pay request')
    expect(link.pay?.memo).equals('memo123')
    expect(link.pay?.memoType).equals('text')
    expect(link.pay?.nativeAmount).equals('100')
    expect(link.pay?.minNativeAmount).equals('50')
    expect(link.pay?.tokenId).equals('badf00d5')
    expect(link.pay?.expires?.valueOf()).equals(expireDate.valueOf())
    expect(link.pay?.isGateway).equals(true)

    // Payment protocol:
    expect(link.paymentProtocol?.paymentProtocolUrl).equals(
      'https://example.com/pay'
    )

    // Private key:
    expect(link.privateKey?.privateKey).equals('privkey')

    // Custom token:
    expect(link.token?.currencyCode).equals('CSTM')
    expect(link.token?.displayName).equals('Custom Token')
    const networkLocation: any = link.token?.networkLocation
    expect(networkLocation.contractAddress).equals('0x1234')
    expect(networkLocation.type).equals('erc20')

    // WalletConnect:
    expect(link.walletConnect).deep.equals(uri.walletConnect)
  })

  it('converts a parsed link into a uri', function () {
    const expires = new Date('2024-02-02T00:00:00Z')
    const link: EdgeParsedLink = {
      pay: {
        publicAddress: 'segwitaddress',
        addressType: 'segwitAddress',
        label: 'Bob',
        message: 'Request',
        memo: 'memo321',
        memoType: 'text',
        nativeAmount: '5',
        minNativeAmount: '1',
        tokenId: 'badf00d5',
        expires,
        isGateway: true
      },
      paymentProtocol: {
        paymentProtocolUrl: 'https://example.com/protocol'
      },
      privateKey: { privateKey: 'otherkey' },
      token: {
        currencyCode: 'CSTM',
        denominations: [{ multiplier: '1', name: 'CSTM' }],
        displayName: 'Custom Token',
        networkLocation: { contractAddress: '0x1234', type: 'erc20' }
      },
      walletConnect: {
        uri: 'wc:def',
        topic: 'topic2',
        version: '2'
      }
    }

    const uri = linkToParsedUri(link)
    expect(uri.publicAddress).equals('segwitaddress')
    expect(uri.segwitAddress).equals('segwitaddress')
    expect(uri.legacyAddress).equals(undefined)
    expect(uri.metadata?.name).equals('Bob')
    expect(uri.metadata?.notes).equals('Request')
    expect((uri.metadata as any)?.gateway).equals(true)
    expect(uri.uniqueIdentifier).equals('memo321')
    expect(uri.nativeAmount).equals('5')
    expect(uri.minNativeAmount).equals('1')
    expect(uri.tokenId).equals('badf00d5')
    expect(uri.expireDate?.getTime()).equals(expires.getTime())
    expect(uri.paymentProtocolUrl).equals('https://example.com/protocol')
    expect(uri.privateKeys).deep.equals(['otherkey'])
    expect(uri.token?.currencyCode).equals('CSTM')
    expect(uri.token?.currencyName).equals('Custom Token')
    expect(uri.token?.contractAddress).equals('0x1234')
    expect((uri.token as any)?.type).equals('erc20')
    expect(uri.walletConnect).deep.equals(link.walletConnect)
  })
})
