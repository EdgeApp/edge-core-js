// @flow

import { Bridgeable, close, emit, update } from 'yaob'

import { authRequest } from '../login/authServer.js'
import { fetchLobbyRequest, makeLobby, sendLobbyReply } from '../login/lobby.js'
import type { LobbyRequest } from '../login/lobby.js'
import { hashUsername } from '../login/login-selectors.js'
import type { ApiInput } from '../root.js'

/**
 * The requesting side of an Edge login lobby.
 * The `replies` property will update as replies come in.
 */
class EdgeLobby extends Bridgeable<
  {
    replies: Array<Object>,
    lobbyId: string
  },
  { error: Error }
> {
  _lobby: Object
  _onError: Function
  _onRepliesChanged: Function
  _replies: Array<Object>
  _unsubscribe: Function

  constructor (lobby: Object) {
    super()
    this._lobby = lobby
    this._onError = () => {}
    this._onRepliesChanged = () => {}
    this._replies = []

    const { unsubscribe } = lobby.subscribe(
      (reply: Object) => {
        this._replies = [...this._replies, reply]
        update(this)
      },
      (e: Error) => {
        emit(this, 'error', e)
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
    close(this)
  }
}

/**
 * A secret internal API which has some goodies for the CLI
 * and for unit testing.
 */
export class EdgeInternalStuff extends Bridgeable<{}> {
  _ai: ApiInput

  constructor (ai: ApiInput) {
    super()
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
