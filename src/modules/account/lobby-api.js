// @flow

import type { EdgeLobby, EdgeLoginRequest } from '../../edge-core-index.js'
import { wrapObject } from '../../util/api.js'
import { base64 } from '../../util/encoding.js'
import { fetchLobbyRequest, sendLobbyReply } from '../login/lobby.js'
import type { LobbyRequest } from '../login/lobby.js'
import { sanitizeLoginStash } from '../login/login.js'
import type { ApiInput } from '../root.js'
import {
  AccountState,
  ensureAccountExists,
  findAppLogin
} from './account-state.js'

interface AppIdInfo {
  displayName: string;
  displayImageUrl?: string;
}

/**
 * Translate an appId into a user-presentable icon and string.
 */
export async function fetchAppIdInfo (
  ai: ApiInput,
  appId: string
): Promise<AppIdInfo> {
  try {
    const url = 'https://info1.edgesecure.co:8444/v1/appIdInfo/' + appId
    const response = await ai.props.io.fetch(url)
    if (!response.ok) {
      throw new Error(`Fetching ${url} returned ${response.status}`)
    }

    const { appName, imageUrl } = await response.json()
    if (!appName) throw new Error(`No appName in appId lookup response.`)

    return { displayImageUrl: imageUrl, displayName: appName }
  } catch (e) {
    ai.props.onError(e)

    // If we can't find the info, just show the appId as a fallback:
    return { displayName: appId }
  }
}

/**
 * Performs an edge login, approving the request in the provided lobby JSON.
 */
async function approveLoginRequest (
  ai: ApiInput,
  appId: string,
  lobbyId: string,
  lobbyJson: LobbyRequest,
  accountState: AccountState
): Promise<mixed> {
  // Ensure that the login object & account repo exist:
  await accountState.syncLogin()
  const loginTree = await ensureAccountExists(ai, accountState.loginTree, appId)
  const requestedLogin = findAppLogin(loginTree, appId)
  if (!requestedLogin) {
    throw new Error('Failed to create the requested login object')
  }
  if (!accountState.loginTree.username) {
    throw new Error('Cannot log in: missing username')
  }

  // Create a sanitized login stash object:
  const stashTree = await ai.props.loginStore.load(
    accountState.loginTree.username
  )
  const loginStash = sanitizeLoginStash(stashTree, appId)

  // Send the reply:
  const replyData = {
    appId,
    loginKey: base64.stringify(requestedLogin.loginKey),
    loginStash
  }
  return sendLobbyReply(ai, lobbyId, lobbyJson, replyData).then(() => {
    setTimeout(() => {
      accountState
        .syncLogin()
        .then(() => {
          setTimeout(() => {
            accountState.syncLogin().catch(e => ai.props.onError(e))
          }, 20000)
          return void 0
        })
        .catch(e => ai.props.onError(e))
    }, 10000)
    return void 0
  })
}

/**
 * Fetches the contents of a lobby and returns them as an EdgeLobby API.
 */
export async function makeLobbyApi (
  ai: ApiInput,
  lobbyId: string,
  accountState: AccountState
): Promise<EdgeLobby> {
  // Look up the lobby on the server:
  const lobbyJson: LobbyRequest = await fetchLobbyRequest(ai, lobbyId)

  // If the lobby has a login request, set up that API:
  let loginRequest: EdgeLoginRequest | void
  if (lobbyJson.loginRequest) {
    const appId = lobbyJson.loginRequest.appId
    if (typeof appId !== 'string') throw new TypeError('Invalid login request')
    const { displayName, displayImageUrl } = await fetchAppIdInfo(ai, appId)

    // Make the API:
    const rawLoginRequest: EdgeLoginRequest = {
      appId,
      displayName,
      displayImageUrl,
      approve () {
        return approveLoginRequest(ai, appId, lobbyId, lobbyJson, accountState)
      }
    }
    loginRequest = wrapObject('LoginRequest', rawLoginRequest)
  }

  const lobbyApi: EdgeLobby = {
    loginRequest
  }
  return wrapObject('Lobby', lobbyApi)
}
