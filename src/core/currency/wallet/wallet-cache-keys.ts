import { EdgeCurrencyTools, EdgeWalletInfo } from '../../../types/types'

/**
 * A wallet's public keys.
 *
 * The account database holds them with the rest of the wallet's boot state,
 * so a seeded wallet already has them and only needs the plugin to confirm
 * they are still current. A plugin that rejects them -- a key format it has
 * since upgraded -- gets them derived again, as does a wallet with nothing
 * seeded.
 *
 * Nothing is written here. The keys reach Redux through
 * `CURRENCY_WALLET_PUBLIC_INFO`, and the cache saver carries them to the
 * wallet's row on its next pass.
 */
export async function getPublicWalletInfo(
  walletInfo: EdgeWalletInfo,
  tools: EdgeCurrencyTools,
  seededWalletInfo?: EdgeWalletInfo
): Promise<EdgeWalletInfo> {
  if (seededWalletInfo != null) {
    if (
      tools.checkPublicKey == null ||
      (await tools.checkPublicKey(seededWalletInfo.keys))
    ) {
      return seededWalletInfo
    }
  }

  let publicKeys = {}
  try {
    publicKeys = await tools.derivePublicKey(walletInfo)
  } catch (error: unknown) {}
  return { id: walletInfo.id, type: walletInfo.type, keys: publicKeys }
}
