import {
  asArray,
  asObject,
  asOptional,
  asString,
  asValue,
  uncleaner
} from 'cleaners'
import { bridgifyObject, close, update, watchMethod } from 'yaob'

import {
  EdgeParsedWalletShareUri,
  EdgePendingWalletShare,
  EdgeWalletInfo,
  EdgeWalletShareMode,
  EdgeWalletShareOptions,
  EdgeWalletShareRecord,
  EdgeWalletShareSpec,
  EdgeWalletSharingState,
  EdgeWalletStates,
  JsonObject
} from '../../types/types'
import { changeWalletStates } from '../account/account-files'
import { walletCanSign } from '../currency/wallet/currency-wallet-api'
import { getPublicWalletInfo } from '../currency/wallet/currency-wallet-pixie'
import {
  findCurrencyPluginId,
  getCurrencyTools
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { makeLocalDisklet } from '../storage/repo'
import { makeWalletShareKeysKit } from './keys'
import { fetchLobbyRequest, makeLobby, sendLobbyReply } from './lobby'
import { applyKit, decryptChildKey } from './login'
import { asEdgeWalletInfo, wasEdgeWalletInfo } from './login-types'

export const REQUEST_WALLETS_URI_PREFIX =
  'https://deep.edge.app/request-wallets/'
export const SHARE_WALLETS_URI_PREFIX = 'https://deep.edge.app/share-wallets/'

/**
 * Builds the link to show as a QR code.
 *
 * The identity rides in the link rather than the lobby request, because the
 * login server keeps only `publicKey`, `timeout` and `loginRequest.appId` and
 * discards everything else. Putting it here also keeps the name off the
 * server entirely: it travels in the QR, to the one person looking at it.
 */
export function makeWalletShareUri(
  direction: 'request' | 'offer',
  lobbyId: string,
  displayName?: string
): string {
  const prefix =
    direction === 'request'
      ? REQUEST_WALLETS_URI_PREFIX
      : SHARE_WALLETS_URI_PREFIX
  const suffix =
    displayName == null || displayName === ''
      ? ''
      : `?name=${encodeURIComponent(displayName)}`
  return `${prefix}${lobbyId}${suffix}`
}

/**
 * Takes a wallet-share link apart. Accepts the `https://deep.edge.app` form
 * and the `edge://` scheme, with or without a `name` parameter.
 */
export function parseWalletShareUri(uri: string): EdgeParsedWalletShareUri {
  const match =
    /^(?:https:\/\/deep\.edge\.app\/|edge:\/\/)(request-wallets|share-wallets)\/([^/?#]+)(\?[^#]*)?/.exec(
      uri.trim()
    )
  if (match == null) {
    throw new SyntaxError(`Not a wallet share link: ${uri}`)
  }
  const [, path, lobbyId, query = ''] = match

  let displayName: string | undefined
  const nameMatch = /[?&]name=([^&]*)/.exec(query)
  if (nameMatch != null) {
    displayName = decodeURIComponent(nameMatch[1].replace(/\+/g, ' '))
    if (displayName === '') displayName = undefined
  }

  return {
    direction: path === 'request-wallets' ? 'request' : 'offer',
    lobbyId,
    displayName
  }
}

/** A shared wallet's key material plus the mode it was shared in. */
export interface WalletShareEntry extends EdgeWalletInfo {
  mode: EdgeWalletShareMode
}

export interface WalletSharePayload {
  version: 1
  /** The sharer's chosen identity, shown to the receiver. */
  senderName?: string
  wallets: WalletShareEntry[]
}

export interface WalletShareHandshake {
  version: 1
  lobbyId: string
  /** The receiver's chosen identity, shown to the sharer. */
  displayName?: string
}

export const asWalletShareEntry = asObject<WalletShareEntry>({
  ...asEdgeWalletInfo.shape,
  mode: asValue('viewOnly', 'spend')
})

export const asWalletSharePayload = asObject<WalletSharePayload>({
  version: asValue(1),
  senderName: asOptional(asString),
  wallets: asArray(asWalletShareEntry)
})

export const asWalletShareHandshake = asObject<WalletShareHandshake>({
  version: asValue(1),
  lobbyId: asString,
  displayName: asOptional(asString)
})

const wasWalletSharePayload = uncleaner(asWalletSharePayload)
const wasWalletShareHandshake = uncleaner(asWalletShareHandshake)

const VIEW_ONLY_KEY_FIELDS = new Set([
  'syncKey',
  'dataKey',
  'imported',
  'publicKeys',
  // Injected by fixWalletInfo for legacy UTXO wallet types; not private material.
  'format',
  'coinType'
])

type WritablePendingWalletShare = {
  -readonly [P in keyof EdgePendingWalletShare]: EdgePendingWalletShare[P]
}

function makePendingShare(
  lobbyId: string,
  uri: string,
  cancelRequest: () => Promise<void>,
  counterpartyName?: string
): WritablePendingWalletShare {
  return {
    id: lobbyId,
    uri,
    cancelRequest,
    watch: watchMethod,
    state: 'pending',
    receivedWalletIds: undefined,
    sharedWallets: undefined,
    counterpartyName,
    error: undefined
  }
}

/**
 * Appends share records to the wallets' sharing history in the account repo.
 *
 * A repeat of a share we already recorded - same party, same capability -
 * adds nothing, so re-scanning a QR does not pad the audit trail.
 */
async function recordShares(
  ai: ApiInput,
  accountId: string,
  side: 'sharedWith' | 'sharedFrom',
  specs: EdgeWalletShareSpec[],
  name: string
): Promise<void> {
  const { walletStates } = ai.props.state.accounts[accountId]
  const sharingDate = new Date().toISOString()

  const newStates: EdgeWalletStates = {}
  for (const { walletId, mode } of specs) {
    const old: EdgeWalletSharingState = walletStates[walletId]?.sharing ?? {
      sharedWith: [],
      sharedFrom: []
    }
    const records = old[side]
    if (
      records.some(record => record.name === name && record.shareType === mode)
    ) {
      continue
    }
    const record: EdgeWalletShareRecord = {
      name,
      shareType: mode,
      sharingDate
    }
    newStates[walletId] = {
      ...walletStates[walletId],
      sharing: {
        sharedWith: [...old.sharedWith],
        sharedFrom: [...old.sharedFrom],
        [side]: [...records, record]
      }
    }
  }

  if (Object.keys(newStates).length === 0) return
  await changeWalletStates(ai, accountId, newStates)
}

/**
 * Builds the keys object to send for one wallet in the chosen mode.
 */
async function buildSharedWalletInfo(
  ai: ApiInput,
  accountId: string,
  walletId: string,
  mode: EdgeWalletShareMode
): Promise<WalletShareEntry> {
  const infos = ai.props.state.accounts[accountId].allWalletInfosFull
  const info = infos.find(key => key.id === walletId)
  if (info == null) {
    throw new Error(`Invalid wallet id ${walletId}`)
  }

  const pluginId = findCurrencyPluginId(
    ai.props.state.plugins.currency,
    info.type
  )
  const plugin = ai.props.state.plugins.currency[pluginId]
  if (mode === 'viewOnly' && plugin.currencyInfo.unsafeSyncNetwork === true) {
    throw new Error(
      `Cannot share wallet ${walletId} (${pluginId}) in viewOnly mode: this currency requires a private key to sync`
    )
  }

  if (mode === 'spend') {
    return {
      id: info.id,
      type: info.type,
      keys: { ...info.keys },
      mode
    }
  }

  // viewOnly: storage keys + already-derived public keys.
  const { syncKey, dataKey, imported } = info.keys
  if (typeof syncKey !== 'string' || typeof dataKey !== 'string') {
    throw new Error(`Wallet ${walletId} is missing sync storage keys`)
  }

  const tools = await getCurrencyTools(ai, pluginId)
  const disklet = makeLocalDisklet(ai.props.io, walletId)
  const publicInfo = await getPublicWalletInfo(info, disklet, tools)
  if (Object.keys(publicInfo.keys).length === 0) {
    throw new Error(
      `Wallet ${walletId} has no public keys available for viewOnly sharing`
    )
  }

  const keys: JsonObject = {
    syncKey,
    dataKey,
    publicKeys: publicInfo.keys
  }
  if (imported === true) keys.imported = true
  // Preserve UTXO metadata so fixWalletInfo does not invent bip32 defaults.
  if (typeof info.keys.format === 'string') keys.format = info.keys.format
  if (typeof info.keys.coinType === 'number') keys.coinType = info.keys.coinType

  return { id: info.id, type: info.type, keys, mode }
}

async function buildSharePayload(
  ai: ApiInput,
  accountId: string,
  specs: EdgeWalletShareSpec[],
  displayName?: string
): Promise<WalletSharePayload> {
  if (specs.length === 0) {
    throw new Error('Must share at least one wallet')
  }
  const wallets: WalletShareEntry[] = []
  for (const { walletId, mode } of specs) {
    wallets.push(await buildSharedWalletInfo(ai, accountId, walletId, mode))
  }
  return {
    version: 1,
    senderName: displayName,
    wallets
  }
}

/**
 * Attaches received wallet keyBoxes to the account login tree.
 * Does not create sync repos — shared syncKeys already exist server-side.
 */
async function attachSharedWallets(
  ai: ApiInput,
  accountId: string,
  payload: WalletSharePayload
): Promise<string[]> {
  if (payload.wallets.length === 0) {
    throw new Error('Wallet share payload contained no wallets')
  }

  // The round-trip through the wallet-info cleaner drops `mode`, which is
  // transport metadata and must never reach the key store.
  const shared = payload.wallets.map(entry => ({
    info: asEdgeWalletInfo(wasEdgeWalletInfo(entry)),
    mode: entry.mode
  }))

  for (const { info, mode } of shared) {
    if (mode === 'viewOnly') {
      if (!isViewOnlyWalletKeys(info.keys)) {
        throw new Error(
          `Wallet share mode is viewOnly but wallet ${info.id} includes spend keys`
        )
      }
    } else if (!walletCanSign(info.keys)) {
      throw new Error(
        `Wallet share mode is spend but wallet ${info.id} has no spend keys`
      )
    }
  }

  // A repeat share must never cost us capability. Wallets we already hold are
  // only re-applied when the incoming keys can spend and ours cannot.
  const existing = ai.props.state.accounts[accountId].allWalletInfosFull
  const walletInfos = shared
    .filter(({ info, mode }) => {
      const old = existing.find(key => key.id === info.id)
      if (old == null) return true
      return mode === 'spend' && !walletCanSign(old.keys)
    })
    .map(entry => entry.info)

  if (walletInfos.length > 0) {
    const { login, sessionKey, stashTree } = ai.props.state.accounts[accountId]
    const childKey = decryptChildKey(stashTree, sessionKey, login.loginId)
    await applyKit(
      ai,
      sessionKey,
      makeWalletShareKeysKit(ai, childKey, walletInfos)
    )
  }

  // Report every wallet the sharer sent, including ones we already had, so
  // the caller can show what the exchange covered.
  return shared.map(entry => entry.info.id)
}

/**
 * Claims the first lobby reply for a one-shot share flow.
 * Returns false if another reply (or cancel) already claimed the pending share.
 */
function claimPendingShare(out: WritablePendingWalletShare): boolean {
  if (out.state !== 'pending') return false
  out.state = 'started'
  update(out)
  return true
}

/**
 * Receiver shows a QR: creates a lobby and waits for a WalletSharePayload.
 */
export async function requestWalletShare(
  ai: ApiInput,
  accountId: string,
  opts: EdgeWalletShareOptions = {}
): Promise<EdgePendingWalletShare> {
  ai.props.log.breadcrumb('requestWalletShare', {})
  let cancelled = false

  async function cancelRequest(): Promise<void> {
    cancelled = true
    for (const cleanup of cleanups) cleanup()
    out.state = 'closed'
    update(out)
    close(out)
  }

  function handleSoftError(error: unknown): void {
    out.error = error
    update(out)
  }

  function handleError(error: unknown): void {
    for (const cleanup of cleanups) cleanup()
    out.state = 'error'
    out.error = error
    update(out)
    close(out)
  }

  async function handleReply(reply: unknown): Promise<void> {
    if (!claimPendingShare(out)) return

    let payload: WalletSharePayload
    try {
      payload = asWalletSharePayload(reply)
    } catch (error: unknown) {
      // Keep listening for a valid reply; do not tear down the lobby yet.
      out.state = 'pending'
      handleSoftError(error)
      return
    }

    for (const cleanup of cleanups) cleanup()
    const specs = payload.wallets.map(entry => ({
      walletId: entry.id,
      mode: entry.mode
    }))
    out.sharedWallets = specs
    out.counterpartyName = payload.senderName
    out.error = undefined
    update(out)

    if (cancelled) return
    const receivedWalletIds = await attachSharedWallets(ai, accountId, payload)
    await recordShares(
      ai,
      accountId,
      'sharedFrom',
      specs,
      payload.senderName ?? ''
    )
    if (cancelled) return
    out.state = 'done'
    out.receivedWalletIds = receivedWalletIds
    out.error = undefined
    update(out)
    close(out)
  }

  const lobby = await makeLobby(ai, { timeout: opts.timeout })
  const cleanups = [
    lobby.close,
    lobby.on('error', handleSoftError),
    lobby.on('reply', reply => {
      handleReply(reply).catch(handleError)
    })
  ]

  const out = makePendingShare(
    lobby.lobbyId,
    makeWalletShareUri('request', lobby.lobbyId, opts.displayName),
    cancelRequest
  )
  return bridgifyObject(out)
}

/**
 * Sharer shows a QR: creates a lobby, waits for a handshake lobby id,
 * then posts the WalletSharePayload to the receiver's lobby.
 */
export async function offerWalletShare(
  ai: ApiInput,
  accountId: string,
  specs: EdgeWalletShareSpec[],
  opts: EdgeWalletShareOptions = {}
): Promise<EdgePendingWalletShare> {
  ai.props.log.breadcrumb('offerWalletShare', {})
  let cancelled = false

  // Build payload early so viewOnly guards fail before showing a QR.
  const payload = await buildSharePayload(
    ai,
    accountId,
    specs,
    opts.displayName
  )
  const replyData = wasWalletSharePayload(payload)

  async function cancelRequest(): Promise<void> {
    cancelled = true
    for (const cleanup of cleanups) cleanup()
    out.state = 'closed'
    update(out)
    close(out)
  }

  function handleSoftError(error: unknown): void {
    out.error = error
    update(out)
  }

  function handleError(error: unknown): void {
    for (const cleanup of cleanups) cleanup()
    out.state = 'error'
    out.error = error
    update(out)
    close(out)
  }

  async function handleReply(reply: unknown): Promise<void> {
    if (!claimPendingShare(out)) return

    let handshake: WalletShareHandshake
    try {
      handshake = asWalletShareHandshake(reply)
    } catch (error: unknown) {
      out.state = 'pending'
      handleSoftError(error)
      return
    }

    for (const cleanup of cleanups) cleanup()
    out.counterpartyName = handshake.displayName
    out.error = undefined
    update(out)

    const receiverLobby = await fetchLobbyRequest(ai, handshake.lobbyId)
    await sendLobbyReply(ai, handshake.lobbyId, receiverLobby, replyData)
    await recordShares(
      ai,
      accountId,
      'sharedWith',
      specs,
      handshake.displayName ?? ''
    )

    if (cancelled) return
    out.state = 'done'
    out.sharedWallets = specs
    out.receivedWalletIds = specs.map(spec => spec.walletId)
    out.error = undefined
    update(out)
    close(out)
  }

  const lobby = await makeLobby(ai, { timeout: opts.timeout })
  const cleanups = [
    lobby.close,
    lobby.on('error', handleSoftError),
    lobby.on('reply', reply => {
      handleReply(reply).catch(handleError)
    })
  ]

  const out = makePendingShare(
    lobby.lobbyId,
    makeWalletShareUri('offer', lobby.lobbyId, opts.displayName),
    cancelRequest
  )
  return bridgifyObject(out)
}

/**
 * Sharer scanned a request-wallets URI: posts the payload to that lobby.
 */
export async function approveWalletShare(
  ai: ApiInput,
  accountId: string,
  lobbyId: string,
  specs: EdgeWalletShareSpec[],
  opts: EdgeWalletShareOptions = {}
): Promise<void> {
  ai.props.log.breadcrumb('approveWalletShare', {})

  const lobbyRequest = await fetchLobbyRequest(ai, lobbyId)
  const payload = await buildSharePayload(
    ai,
    accountId,
    specs,
    opts.displayName
  )
  await sendLobbyReply(
    ai,
    lobbyId,
    lobbyRequest,
    wasWalletSharePayload(payload)
  )
  await recordShares(
    ai,
    accountId,
    'sharedWith',
    specs,
    opts.counterpartyName ?? ''
  )
}

/**
 * Receiver scanned a share-wallets URI: creates a reply lobby, posts a
 * handshake to the offer lobby, and waits for the WalletSharePayload.
 */
export async function acceptWalletShare(
  ai: ApiInput,
  accountId: string,
  offerLobbyId: string,
  opts: EdgeWalletShareOptions = {}
): Promise<EdgePendingWalletShare> {
  ai.props.log.breadcrumb('acceptWalletShare', {})
  let cancelled = false

  // Create our own lobby first so the sharer can reply to it.
  const receiverLobby = await makeLobby(ai, { timeout: opts.timeout })

  async function cancelRequest(): Promise<void> {
    cancelled = true
    for (const cleanup of cleanups) cleanup()
    out.state = 'closed'
    update(out)
    close(out)
  }

  function handleSoftError(error: unknown): void {
    out.error = error
    update(out)
  }

  function handleError(error: unknown): void {
    for (const cleanup of cleanups) cleanup()
    out.state = 'error'
    out.error = error
    update(out)
    close(out)
  }

  async function handleReply(reply: unknown): Promise<void> {
    if (!claimPendingShare(out)) return

    let payload: WalletSharePayload
    try {
      payload = asWalletSharePayload(reply)
    } catch (error: unknown) {
      out.state = 'pending'
      handleSoftError(error)
      return
    }

    for (const cleanup of cleanups) cleanup()
    const specs = payload.wallets.map(entry => ({
      walletId: entry.id,
      mode: entry.mode
    }))
    out.sharedWallets = specs
    if (payload.senderName != null) out.counterpartyName = payload.senderName
    out.error = undefined
    update(out)

    if (cancelled) return
    const receivedWalletIds = await attachSharedWallets(ai, accountId, payload)
    await recordShares(
      ai,
      accountId,
      'sharedFrom',
      specs,
      payload.senderName ?? ''
    )
    if (cancelled) return
    out.state = 'done'
    out.receivedWalletIds = receivedWalletIds
    out.error = undefined
    update(out)
    close(out)
  }

  const cleanups = [
    receiverLobby.close,
    receiverLobby.on('error', handleSoftError),
    receiverLobby.on('reply', reply => {
      handleReply(reply).catch(handleError)
    })
  ]

  const out = makePendingShare(
    receiverLobby.lobbyId,
    makeWalletShareUri('request', receiverLobby.lobbyId),
    cancelRequest,
    opts.counterpartyName
  )

  // Handshake: tell the offer lobby where to send the encrypted payload.
  try {
    const offerRequest = await fetchLobbyRequest(ai, offerLobbyId)
    await sendLobbyReply(
      ai,
      offerLobbyId,
      offerRequest,
      wasWalletShareHandshake({
        version: 1,
        lobbyId: receiverLobby.lobbyId,
        displayName: opts.displayName
      })
    )
  } catch (error: unknown) {
    handleError(error)
  }

  return bridgifyObject(out)
}

/**
 * True when keys look like a view-only share (no private spend material).
 */
export function isViewOnlyWalletKeys(keys: JsonObject): boolean {
  for (const key of Object.keys(keys)) {
    if (!VIEW_ONLY_KEY_FIELDS.has(key)) return false
  }
  return keys.publicKeys != null
}
