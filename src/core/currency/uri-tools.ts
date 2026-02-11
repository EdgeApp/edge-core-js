import {
  EdgeCurrencyInfo,
  EdgeParsedLink,
  EdgeParsedUri,
  EdgeTokenMap
} from '../../types/types'
import { makeMetaToken } from '../account/custom-tokens'

export function parsedUriToLink(
  uri: EdgeParsedUri,
  currencyInfo: EdgeCurrencyInfo,
  allTokens: EdgeTokenMap
): EdgeParsedLink {
  const {
    // Edge has never supported BitID:
    // bitIDCallbackUri,
    // bitIDDomain,
    // bitidKycProvider, // Experimental
    // bitidKycRequest, // Experimental
    // bitidPaymentAddress, // Experimental
    // bitIDURI,

    // The GUI handles address requests:
    // returnUri,

    currencyCode,
    expireDate,
    legacyAddress,
    metadata,
    minNativeAmount,
    nativeAmount,
    paymentProtocolUrl,
    privateKeys,
    publicAddress,
    segwitAddress,
    token,
    uniqueIdentifier,
    walletConnect
  } = uri
  let { tokenId } = uri

  if (tokenId === undefined && currencyCode != null) {
    tokenId =
      currencyCode === currencyInfo.currencyCode
        ? null
        : Object.keys(allTokens).find(
            tokenId => allTokens[tokenId].currencyCode === currencyCode
          )
  }

  const out: EdgeParsedLink = {}

  // Payment addresses:
  const payAddress = legacyAddress ?? publicAddress ?? segwitAddress
  if (payAddress != null) {
    out.pay = {
      publicAddress: payAddress,
      addressType:
        legacyAddress != null
          ? 'legacyAddress'
          : publicAddress != null
          ? 'publicAddress'
          : 'segwitAddress',
      label: metadata?.name,
      message: metadata?.notes,
      memo: uniqueIdentifier,
      memoType: 'text',
      nativeAmount: nativeAmount,
      minNativeAmount: minNativeAmount,
      tokenId: tokenId,
      expires: expireDate,
      // Plugins marked RenBridge Gateway addresses using this
      // undocumented field:
      isGateway: (metadata as any)?.gateway
    }
  }

  if (paymentProtocolUrl != null) {
    out.paymentProtocol = { paymentProtocolUrl }
  }

  // Private keys:
  if (privateKeys != null && privateKeys.length > 0) {
    out.privateKey = { privateKey: privateKeys[0] }
  }

  // Custom tokens:
  if (token != null) {
    const { contractAddress, currencyCode, currencyName, denominations } = token
    out.token = {
      currencyCode,
      denominations,
      displayName: currencyName,
      networkLocation: {
        contractAddress,
        // The edge-currency-accountbased custom token parser would
        // insert this undocumented field into `EdgeMetaToken`.
        // We can preserve this information in `networkLocation`,
        // which is a free-form field designed to hold info like this:
        type: (token as any).type
      }
    }
  }

  if (walletConnect != null) {
    out.walletConnect = walletConnect
  }

  return out
}

export function linkToParsedUri(link: EdgeParsedLink): EdgeParsedUri {
  const out: EdgeParsedUri = {}

  // Payment addresses:
  if (link.pay != null) {
    const {
      publicAddress,
      addressType,
      label,
      message,
      memo,
      nativeAmount,
      minNativeAmount,
      tokenId,
      expires,
      isGateway
    } = link.pay
    out.publicAddress = publicAddress
    if (addressType === 'legacyAddress') out.legacyAddress = publicAddress
    if (addressType === 'segwitAddress') out.segwitAddress = publicAddress
    out.metadata = {
      name: label,
      notes: message,
      // @ts-expect-error Undocumented feature:
      gateway: isGateway
    }
    out.uniqueIdentifier = memo
    out.nativeAmount = nativeAmount
    out.minNativeAmount = minNativeAmount
    out.tokenId = tokenId
    out.expireDate = expires
    ;(out as any).gateway = isGateway
  }

  // Payment protocol:
  if (link.paymentProtocol != null) {
    const { paymentProtocolUrl } = link.paymentProtocol
    out.paymentProtocolUrl = paymentProtocolUrl
  }

  // Private keys:
  if (link.privateKey != null) {
    const { privateKey } = link.privateKey
    out.privateKeys = [privateKey]
  }

  // Custom tokens:
  if (link.token != null) {
    out.token = makeMetaToken(link.token)
    // @ts-expect-error Undocumented "ERC20" field:
    out.token.type = link.token.networkLocation.type
  }

  if (link.walletConnect != null) {
    out.walletConnect = link.walletConnect
  }

  return out
}
