// @flow
import type { AbcLobby, AbcLoginRequest } from 'airbitz-core-types'
import { wrapObject } from '../../util/api.js'
import { base64 } from '../../util/encoding.js'
import { fetchLobbyRequest, sendLobbyReply } from '../login/lobby.js'
import type { LobbyRequest } from '../login/lobby.js'
import type { ApiInput } from '../root.js'
import { ensureAccountExists, findAppLogin } from './accountState.js'

interface AppIdInfo {
  displayName: string,
  displayImageUrl?: string
}

/**
 * Translate an appId into a user-presentable icon and string.
 */
async function fetchAppIdInfo (
  ai: ApiInput,
  appId: string
): Promise<AppIdInfo> {
  const url = 'https://info1.edgesecure.co:8444/v1/appIdInfo/' + appId
  const response = await ai.props.io.fetch(url)
  if (!response.ok) {
    // If we can't find the info, just show the appId as a fallback:
    return { displayName: appId }
  }
  return response.json()
}

/**
 * Performs an edge login, approving the request in the provided lobby JSON.
 */
async function approveLoginRequest (
  ai: ApiInput,
  appId: string,
  lobbyId: string,
  lobbyJson: LobbyRequest,
  accountState: any
): Promise<void> {
  // Ensure that the login object & account repo exist:
  const loginTree = await ensureAccountExists(ai, accountState.loginTree, appId)
  const requestedLogin = findAppLogin(loginTree, appId)
  if (!requestedLogin) {
    throw new Error('Failed to create the requested login object')
  }

  // Create a sanitized login stash object:
  const stashTree = await ai.props.loginStore.load(
    accountState.loginTree.username
  )
  // TODO: Sanitize
  const loginStash = stashTree

  // Send the reply:
  const replyData = {
    appId,
    loginKey: base64.stringify(requestedLogin.loginKey),
    loginStash
  }
  return sendLobbyReply(ai, lobbyId, lobbyJson, replyData)
}

/**
 * Fetches the contents of a lobby and returns them as an AbcLobby API.
 */
export async function makeLobbyApi (
  ai: ApiInput,
  lobbyId: string,
  accountState: any
): Promise<AbcLobby> {
  const lobbyApi: AbcLobby = {}

  // Look up the lobby on the server:
  const lobbyJson: LobbyRequest = await fetchLobbyRequest(ai, lobbyId)

  // If the lobby has a login request, set up that API:
  if (lobbyJson.loginRequest) {
    const appId = lobbyJson.loginRequest.appId
    if (typeof appId !== 'string') throw new TypeError('Invalid login request')
    const { displayName, displayImageUrl } = await fetchAppIdInfo(ai, appId)

    // Make the API:
    const rawLoginRequest: AbcLoginRequest = {
      appId,
      displayName,
      approve () {
        return approveLoginRequest(ai, appId, lobbyId, lobbyJson, accountState)
      }
    }
    if (displayImageUrl) rawLoginRequest.displayImageUrl = displayImageUrl

    // Wrap the API:
    lobbyApi.loginRequest = wrapObject(
      ai.props.onError,
      'LoginRequest',
      rawLoginRequest
    )
  }

  return wrapObject(ai.props.onError, 'Lobby', lobbyApi)
}
