import { asObject, asOptional, asString, asValue } from 'cleaners'
import { isPixieShutdownError } from 'redux-pixies'

import { EdgeCurrencyWallet, EdgeSpendInfo } from '../../types/types'
import { makeJsonFile } from '../../util/file-helpers'
import { ApiInput, RootProps } from '../root-pixie'

/**
 * eCash (ECX) wallet types, which are Bitcoin forks without automatic
 * replay protection.
 */
export const ecxWalletTypes = [
  'wallet:ecashbitcoin',
  'wallet:ecashbitcoinbetanet'
]

/**
 * The replay protection of an ECX wallet split from Bitcoin. It lives in the
 * wallet's synced storage, so a later login (on any device) finishes a sweep
 * this session did not, and the GUI can tell whether the wallet still shares
 * its coins with Bitcoin:
 * - `pending`: the protection sweep has not gone out.
 * - `sent`: the sweep went out as `txid`.
 * - `empty`: the wallet had nothing to sweep once it synced.
 */
const asEcxProtectionFile = asObject({
  status: asValue('pending', 'sent', 'empty'),
  txid: asOptional(asString)
})

const ECX_PROTECTION_FILE = 'EcxProtection.json'
const ecxProtectionFile = makeJsonFile(asEcxProtectionFile)

// The latest sweep attempt for each wallet id, so attempts never overlap:
const ecxSweeps = new Map<string, Promise<void>>()

/**
 * Records that an ECX wallet just split from Bitcoin needs protection.
 */
export async function saveEcxProtectionPending(
  wallet: EdgeCurrencyWallet
): Promise<void> {
  await ecxProtectionFile.save(wallet.disklet, ECX_PROTECTION_FILE, {
    status: 'pending',
    txid: undefined
  })
}

/**
 * Sweeps an ECX wallet whose saved protection status is pending, once the
 * wallet syncs. Any number of calls may wait at once, but only one sweeps:
 * each re-reads the status before sweeping, one at a time.
 */
export async function resumeEcxProtection(
  ai: ApiInput,
  wallet: EdgeCurrencyWallet
): Promise<void> {
  if (!(await isEcxProtectionPending(wallet))) return

  // Wait until the wallet has found every coin it shares with Bitcoin.
  // A wallet that goes away first (logout, archiving, deletion) keeps its
  // pending status, so its next load picks the protection back up:
  let isSynced: boolean
  try {
    isSynced = await ai.waitFor((props: RootProps): boolean | undefined => {
      // A logged-out account's props have no currency state:
      const { currency } = props.state
      if (currency == null) return false
      const walletState = currency.wallets[wallet.id]
      if (walletState == null) return false
      if (walletState.engineFailure != null) throw walletState.engineFailure
      if (walletState.syncStatus.totalRatio >= 1) return true
    })
  } catch (error: unknown) {
    if (!isPixieShutdownError(error)) throw error
    isSynced = false
  }
  if (!isSynced) {
    ai.props.log.warn(
      `ECX protection for ${wallet.id} waits for the wallet's next load`
    )
    return
  }

  const previous = ecxSweeps.get(wallet.id) ?? Promise.resolve()
  const current = previous
    // The call that made the previous attempt reports its errors:
    .catch(() => {})
    .then(async () => {
      // Another call may have swept while this one waited:
      if (await isEcxProtectionPending(wallet)) await sweepEcxWallet(wallet)
    })
  ecxSweeps.set(wallet.id, current)
  try {
    await current
  } finally {
    if (ecxSweeps.get(wallet.id) === current) ecxSweeps.delete(wallet.id)
  }
}

async function isEcxProtectionPending(
  wallet: EdgeCurrencyWallet
): Promise<boolean> {
  const file = await ecxProtectionFile.load(wallet.disklet, ECX_PROTECTION_FILE)
  return file?.status === 'pending'
}

async function sweepEcxWallet(wallet: EdgeCurrencyWallet): Promise<void> {
  // Sweep the wallet to itself. The ECX plugin's magic nLockTime makes
  // the sweep invalid on Bitcoin, so it spends the shared UTXOs on the
  // ECX chain only. Bitcoin spends of those UTXOs then can't replay on ECX.
  // Native segwit keeps the swept coins as cheap to spend as possible:
  const receiveAddress = await wallet.getReceiveAddress({ tokenId: null })
  const publicAddress =
    receiveAddress.segwitAddress ?? receiveAddress.publicAddress
  const spendInfo: EdgeSpendInfo = {
    tokenId: null,
    metadata: {
      name: 'Replay Protection Tx',
      notes:
        'This transaction separates your ECX from your BTC. Please wait for it to confirm before spending from the Bitcoin wallet this wallet was split from.'
    },
    networkFeeOption: 'high',
    spendTargets: [{ publicAddress, nativeAmount: '0' }]
  }
  const maxAmount = await wallet.getMaxSpendable(spendInfo)
  if (maxAmount === '0') {
    await ecxProtectionFile.save(wallet.disklet, ECX_PROTECTION_FILE, {
      status: 'empty',
      txid: undefined
    })
    return
  }
  spendInfo.spendTargets[0].nativeAmount = maxAmount
  const protectTx = await wallet.makeSpend(spendInfo)
  const signedProtectTx = await wallet.signTx(protectTx)
  const broadcastedProtectTx = await wallet.broadcastTx(signedProtectTx)

  // Saved as soon as the sweep is out, so no later load sends another:
  await ecxProtectionFile.save(wallet.disklet, ECX_PROTECTION_FILE, {
    status: 'sent',
    txid: broadcastedProtectTx.txid
  })
  await wallet.saveTx(broadcastedProtectTx)
}
