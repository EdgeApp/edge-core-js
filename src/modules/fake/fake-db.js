// @flow

import { type EdgeFakeUser } from '../../types/types.js'
import { filterObject } from '../../util/util.js'

// The information the server returns on every login:
export const loginReplyColumns = [
  // Identity:
  'appId',
  'loginAuthBox',
  'loginId',
  // Login methods:
  'otpResetDate',
  'otpTimeout',
  'passwordAuthBox',
  'passwordAuthSnrp',
  'passwordBox',
  'passwordKeySnrp',
  'pin2Box',
  'pin2KeyBox',
  'pin2TextBox',
  'question2Box',
  'recovery2Box',
  'recovery2KeyBox',
  // Resources:
  'keyBoxes',
  'mnemonicBox',
  'parentBox',
  'rootKeyBox',
  'syncKeyBox'
]

// The database includes extra columns used for authentication:
export const loginDbColumns = [
  ...loginReplyColumns,
  'loginAuth',
  'otpKey',
  'passwordAuth',
  'pin2Auth',
  'pin2Id',
  'recovery2Auth',
  'recovery2Id',
  // Legacy:
  'pinBox',
  'pinId',
  'pinKeyBox'
]

// The v2 account creation endpoint doesn't accept legacy keys:
export const loginCreateColumns: Array<string> = loginDbColumns.filter(
  item => ['mnemonicBox', 'rootKeyBox', 'syncKeyBox'].indexOf(item) < 0
)

/**
 * Emulates the Airbitz login server database.
 */
export class FakeDb {
  db: {
    lobbies: { [lobbyId: string]: Object },
    logins: Array<Object>
  }
  repos: { [syncKey: string]: Object }
  offline: boolean

  constructor () {
    this.db = { lobbies: {}, logins: [] }
    this.repos = {}
  }

  findLoginId (loginId: string) {
    if (loginId == null) return
    return this.db.logins.find(login => login.loginId === loginId)
  }

  findPin2Id (pin2Id: string) {
    return this.db.logins.find(login => login.pin2Id === pin2Id)
  }

  findRecovery2Id (recovery2Id: string) {
    return this.db.logins.find(login => login.recovery2Id === recovery2Id)
  }

  makeReply (login: Object) {
    const reply = filterObject(login, loginReplyColumns)
    reply.children = this.db.logins
      .filter(child => child.parent === login.loginId)
      .map(child => this.makeReply(child))
    return reply
  }

  setupFakeLogin (user: Object, parent: string | null) {
    // Fill in the database row for this login:
    const row = filterObject(user, loginDbColumns)
    row.parent = parent
    this.db.logins.push(row)

    // Recurse into our children:
    if (user.children != null) {
      for (const child of user.children) {
        this.setupFakeLogin(child, user.loginId)
      }
    }
  }

  setupFakeUser (user: EdgeFakeUser) {
    this.setupFakeLogin(user.server, null)

    // Create fake repos:
    for (const syncKey of Object.keys(user.repos)) {
      this.repos[syncKey] = { ...user.repos[syncKey] }
    }
  }

  dumpLogin (login: Object) {
    const out = filterObject(login, loginDbColumns)
    out.children = this.db.logins
      .filter(child => child.parent === login.loginId)
      .map(child => this.dumpLogin(child))
    return out
  }
}
