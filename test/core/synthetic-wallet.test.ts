import { expect } from 'chai'
import { describe, it } from 'mocha'
import { Bridgeable, bridgifyObject, makeLocalBridge } from 'yaob'

import {
  makeSyntheticDestinationWallet,
  SYNTHETIC_WALLET_ID_PREFIX
} from '../../src/core/swap/synthetic-wallet'
import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeSwapToAddressInfo,
  EdgeToken,
  EdgeTokenMap
} from '../../src/index'

// A real destination address the GUI would paste in:
const PAYOUT_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'
const USDC_TOKEN_ID = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const usdcToken: EdgeToken = {
  currencyCode: 'USDC',
  displayName: 'USD Coin',
  denominations: [{ name: 'USDC', multiplier: '1000000' }],
  networkLocation: { contractAddress: `0x${USDC_TOKEN_ID}` }
}
const allTokens: EdgeTokenMap = { [USDC_TOKEN_ID]: usdcToken }

const currencyInfo: EdgeCurrencyInfo = {
  pluginId: 'ethereum',
  currencyCode: 'ETH',
  walletType: 'wallet:ethereum',
  displayName: 'Ethereum',
  denominations: [{ name: 'ETH', multiplier: '1000000000000000000' }]
} as unknown as EdgeCurrencyInfo

// Stand-in for the real, bridgeable `currencyConfig` the core already holds for
// the destination plugin. Only the surface the synthetic wallet reads is needed.
const currencyConfig = bridgifyObject({
  currencyInfo,
  allTokens
}) as unknown as EdgeCurrencyConfig

/**
 * The shape the GUI sees across the bridge. It accepts ONLY the descriptor
 * (plain data) and returns what a plugin-faithful consumer read off the
 * core-built synthetic destination, plus the synthetic itself.
 */
interface ConsumerReads {
  address: string
  receiveAddress: string
  tokenCurrencyCode: string | undefined
  parentCurrencyCode: string
  walletType: string
  walletId: string
}
interface DestinationProof {
  consumer: ConsumerReads
  toWallet: EdgeCurrencyWallet
}
interface CoreSwapApi {
  buildDestination: (
    toAddressInfo: EdgeSwapToAddressInfo
  ) => Promise<DestinationProof>
}

/**
 * Mirrors the core side of the production GUI<->core bridge: it receives the
 * descriptor, builds the synthetic destination, and runs a consumer that makes
 * exactly the reads swap plugins make on `toWallet`.
 */
class FakeCoreSwapApi extends Bridgeable<CoreSwapApi> implements CoreSwapApi {
  async buildDestination(
    toAddressInfo: EdgeSwapToAddressInfo
  ): Promise<DestinationProof> {
    const synthetic = makeSyntheticDestinationWallet(
      currencyConfig,
      toAddressInfo.toAddress
    )

    // Plugin-faithful consumer (runs core-side, by reference): the same reads
    // `getAddress`, `getReceiveAddress`, `denominationToNative`, and the central
    // plugins make on a destination wallet.
    const addresses = await synthetic.getAddresses({ tokenId: null })
    const receiveAddress = await synthetic.getReceiveAddress({ tokenId: null })
    const token =
      toAddressInfo.toTokenId != null
        ? synthetic.currencyConfig.allTokens[toAddressInfo.toTokenId]
        : undefined

    const consumer: ConsumerReads = {
      address: addresses[0].publicAddress,
      receiveAddress: receiveAddress.publicAddress,
      tokenCurrencyCode: token?.currencyCode,
      parentCurrencyCode: synthetic.currencyInfo.currencyCode,
      walletType: synthetic.type,
      walletId: synthetic.id
    }
    return { consumer, toWallet: synthetic }
  }
}

describe('synthetic destination wallet', function () {
  // Same wire format edge-core-js uses in production (index.ts): a JSON
  // round-trip on every message.
  const guiApi: CoreSwapApi = makeLocalBridge(new FakeCoreSwapApi(), {
    cloneMessage: message => JSON.parse(JSON.stringify(message))
  })

  it('builds a working destination from a descriptor across the bridge', async function () {
    // The GUI passes ONLY the descriptor (plain data) — the exact thing that
    // crosses the bridge cleanly, unlike the Phase 1 GUI-built fake wallet.
    const toAddressInfo: EdgeSwapToAddressInfo = {
      toPluginId: 'ethereum',
      toTokenId: USDC_TOKEN_ID,
      toAddress: PAYOUT_ADDRESS
    }
    const proof = await guiApi.buildDestination(toAddressInfo)

    // The core-side consumer got a fully working destination:
    expect(proof.consumer.address).equals(PAYOUT_ADDRESS)
    expect(proof.consumer.receiveAddress).equals(PAYOUT_ADDRESS)
    expect(proof.consumer.tokenCurrencyCode).equals('USDC')
    expect(proof.consumer.parentCurrencyCode).equals('ETH')
    expect(proof.consumer.walletType).equals('wallet:ethereum')
    expect(proof.consumer.walletId).equals(
      `${SYNTHETIC_WALLET_ID_PREFIX}ethereum`
    )

    // And the bridgified synthetic survives the trip back GUI-ward and is
    // callable across the wire — the direct inverse of the Phase 1 failure,
    // where the fake's function properties threw on argument unpack.
    const guiAddresses = await proof.toWallet.getAddresses({ tokenId: null })
    expect(guiAddresses[0].publicAddress).equals(PAYOUT_ADDRESS)
  })

  it('builds a parent-currency destination when toTokenId is null', async function () {
    const proof = await guiApi.buildDestination({
      toPluginId: 'ethereum',
      toTokenId: null,
      toAddress: PAYOUT_ADDRESS
    })

    expect(proof.consumer.address).equals(PAYOUT_ADDRESS)
    expect(proof.consumer.tokenCurrencyCode).equals(undefined)
    expect(proof.consumer.parentCurrencyCode).equals('ETH')
  })
})
