import { asObject, asOptional, asString, uncleaner } from 'cleaners'
import { bridgifyObject, close } from 'yaob'

import { EdgeLobbyRequest } from '../../types/server-types'
import { EdgeLobby, EdgeLoginRequest } from '../../types/types'
import { shuffle } from '../../util/shuffle'
import { asLobbyLoginPayload } from '../login/edge'
import { fetchLobbyRequest, sendLobbyReply } from '../login/lobby'
import { sanitizeLoginStash, syncLogin } from '../login/login'
import { getStashById } from '../login/login-selectors'
import { ApiInput } from '../root-pixie'
import { ensureAccountExists, findAppLogin } from './account-init'

const wasLobbyLoginPayload = uncleaner(asLobbyLoginPayload)

interface AppIdInfo {
  appName: string
  darkImageUrl?: string
  lightImageUrl?: string

  // Deprecated. Newer servers will return dark & light images:
  imageUrl?: string
}

const asAppIdInfo = asObject<AppIdInfo>({
  appName: asString,
  darkImageUrl: asOptional(asString),
  lightImageUrl: asOptional(asString),
  imageUrl: asOptional(asString)
})

/**
 * Translate an appId into a user-presentable icon and string.
 */
export async function fetchAppIdInfo(
  ai: ApiInput,
  appId: string
): Promise<AppIdInfo> {
  try {
    const [infoServerUri] = shuffle(ai.props.state.infoServers)
    const url = `${infoServerUri}/v1/appIdInfo/${appId}`
    const response = await ai.props.io.fetch(url)
    if (response.status === 404) {
      return { appName: appId }
    }
    if (!response.ok) {
      throw new Error(`Fetching ${url} returned ${response.status}`)
    }
    const clean = asAppIdInfo(await response.json())

    // Upgrade legacy responses:
    if (clean.lightImageUrl == null) clean.lightImageUrl = clean.imageUrl
    if (clean.darkImageUrl == null) clean.darkImageUrl = clean.imageUrl

    return clean
  } catch (error: unknown) {
    // Log failures, but still return the appId as a fallback:
    ai.props.onError(error)
    return { appName: appId }
  }
}

/**
 * Performs an edge login, approving the request in the provided lobby JSON.
 */
async function approveLoginRequest(
  ai: ApiInput,
  accountId: string,
  appId: string,
  lobbyId: string,
  lobbyJson: EdgeLobbyRequest
): Promise<void> {
  const { login, loginTree } = ai.props.state.accounts[accountId]

  // Ensure that the login object & account repo exist:
  await syncLogin(ai, loginTree, login)

  const newLoginTree = await ensureAccountExists(ai, loginTree, appId)
  const requestedLogin = findAppLogin(newLoginTree, appId)
  if (requestedLogin == null) {
    throw new Error('Failed to create the requested login object')
  }

  // Create a sanitized login stash object:
  const { stashTree } = getStashById(ai, loginTree.loginId)
  const loginStash = sanitizeLoginStash(stashTree, appId)

  // Send the reply:
  const replyData = wasLobbyLoginPayload({
    appId,
    loginKey: requestedLogin.loginKey,
    loginStash
  })
  await sendLobbyReply(ai, lobbyId, lobbyJson, replyData)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const accountApi = ai.props.output.accounts[accountId].accountApi
  if (accountApi != null) {
    accountApi.on('close', () => {
      if (timeout != null) clearTimeout(timeout)
    })
  }

  timeout = setTimeout(() => {
    timeout = undefined
    syncLogin(ai, newLoginTree, requestedLogin)
      .then(() => {
        timeout = setTimeout(() => {
          timeout = undefined
          syncLogin(ai, newLoginTree, requestedLogin).catch(error =>
            ai.props.onError(error)
          )
        }, 20000)
      })
      .catch(error => ai.props.onError(error))
  }, 10000)
}

/**
 * Fetches the contents of a lobby and returns them as an EdgeLobby API.
 */
export async function makeLobbyApi(
  ai: ApiInput,
  accountId: string,
  lobbyId: string
): Promise<EdgeLobby> {
  // Look up the lobby on the server:
  const lobbyJson = await fetchLobbyRequest(ai, lobbyId)

  // If the lobby has a login request, set up that API:
  let loginRequest: EdgeLoginRequest | undefined
  if (lobbyJson.loginRequest != null) {
    loginRequest = await unpackLoginRequest(
      ai,
      accountId,
      lobbyId,
      lobbyJson,
      lobbyJson.loginRequest.appId
    )
  }

  const out: EdgeLobby = {
    loginRequest
  }
  bridgifyObject(out)

  return out
}

async function unpackLoginRequest(
  ai: ApiInput,
  accountId: string,
  lobbyId: string,
  lobbyJson: EdgeLobbyRequest,
  appId: string
): Promise<EdgeLoginRequest> {
  const info = await fetchAppIdInfo(ai, appId)

  // Make the API:
  const out: EdgeLoginRequest = {
    appId,
    displayName: info.appName,
    displayImageDarkUrl: info.darkImageUrl,
    displayImageLightUrl: info.lightImageUrl,

    approve(): Promise<void> {
      return approveLoginRequest(ai, accountId, appId, lobbyId, lobbyJson)
    },

    async close(): Promise<void> {
      close(out)
    }
  }
  bridgifyObject(out)
  return out
}
