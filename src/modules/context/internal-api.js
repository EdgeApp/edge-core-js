// @flow

import { authRequest } from '../login/authServer.js'
import { fetchLobbyRequest, makeLobby, sendLobbyReply } from '../login/lobby.js'
import type { LobbyRequest } from '../login/lobby.js'
import { hashUsername } from '../login/loginStore.js'
import type { ApiInput } from '../root.js'

/**
 * The requesting side of an Edge login lobby.
 * The `replies` property will update as replies come in.
 */
class EdgeLobby {
  _lobby: Object
  _onError: Function
  _onRepliesChanged: Function
  _replies: Array<Object>
  _unsubscribe: Function

  constructor (lobby: Object) {
    this._lobby = lobby
    this._onError = () => {}
    this._onRepliesChanged = () => {}
    this._replies = []

    const { unsubscribe } = lobby.subscribe(
      (reply: Object) => {
        this._replies = [...this._replies, reply]
        this._onRepliesChanged(this._replies)
      },
      (e: Error) => {
        this._onError(e)
      }
    )
    this._unsubscribe = unsubscribe
  }

  get lobbyId (): string {
    return this._lobby.lobbyId
  }

  get replies (): Array<Object> {
    return this._replies
  }

  close () {
    this._unsubscribe()
  }

  on (name: string, f: Function) {
    if (name === 'error') this._onError = f
    else this._onRepliesChanged = f
  }
}

/**
 * A secret internal API which has some goodies for the CLI
 * and for unit testing.
 */
export class EdgeInternalStuff {
  _ai: ApiInput

  constructor (ai: ApiInput) {
    this._ai = ai
  }

  authRequest (method: string, path: string, body?: {}) {
    return authRequest(this._ai, method, path, body)
  }

  hashUsername (username: string): Promise<Uint8Array> {
    return hashUsername(this._ai, username)
  }

  async makeLobby (lobbyRequest: LobbyRequest, period: number = 1000) {
    const lobby = await makeLobby(this._ai, lobbyRequest, period)
    return new EdgeLobby(lobby)
  }

  fetchLobbyRequest (lobbyId: string) {
    return fetchLobbyRequest(this._ai, lobbyId)
  }

  sendLobbyReply (
    lobbyId: string,
    lobbyRequest: LobbyRequest,
    replyData: Object
  ) {
    return sendLobbyReply(this._ai, lobbyId, lobbyRequest, replyData)
  }
}
