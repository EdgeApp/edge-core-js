// @flow

import { type FakeUser, type LoginDump } from '../../types/fake-types.js'
import {
  type EdgeBox,
  type EdgeLobbyReply,
  type EdgeLobbyRequest,
  type LoginPayload
} from '../../types/server-types.js'
import { verifyData } from '../../util/crypto/verify.js'

/**
 * A barcode-login lobby stored in the fake database.
 */
export type DbLobby = {
  expires: string, // date
  request: EdgeLobbyRequest,
  replies: EdgeLobbyReply[]
}

/**
 * A login object stored in the fake database.
 */
export type DbLogin = $Diff<LoginDump, { children: mixed }>

/**
 * A sync repo stored in the fake database.
 */
export type DbRepo = { [path: string]: EdgeBox }

/**
 * Emulates the Airbitz login server database.
 */
export class FakeDb {
  lobbies: { [lobbyId: string]: DbLobby }
  logins: DbLogin[]
  repos: { [syncKey: string]: DbRepo }

  constructor() {
    this.lobbies = {}
    this.logins = []
    this.repos = {}
  }

  getLoginById(loginId: Uint8Array): DbLogin | void {
    return this.logins.find(login => verifyData(login.loginId, loginId))
  }

  getLoginByPin2Id(pin2Id: Uint8Array): DbLogin | void {
    return this.logins.find(
      login => login.pin2Id != null && verifyData(login.pin2Id, pin2Id)
    )
  }

  getLoginByRecovery2Id(recovery2Id: Uint8Array): DbLogin | void {
    return this.logins.find(
      login =>
        login.recovery2Id != null && verifyData(login.recovery2Id, recovery2Id)
    )
  }

  getLoginsByParent(parent: DbLogin): DbLogin[] {
    return this.logins.filter(child => child.parentId === parent.loginId)
  }

  insertLogin(login: DbLogin): void {
    this.logins.push(login)
  }

  // Dumping & restoration --------------------------------------------

  setupFakeUser(user: FakeUser): void {
    const setupLogin = (dump: LoginDump): void => {
      const { children, ...rest } = dump
      this.insertLogin(rest)
      for (const child of children) {
        child.parentId = dump.loginId
        setupLogin(child)
      }
    }
    setupLogin(user.server)

    // Create fake repos:
    for (const syncKey of Object.keys(user.repos)) {
      this.repos[syncKey] = { ...user.repos[syncKey] }
    }
  }

  dumpLogin(login: DbLogin): LoginDump {
    const makeTree = (login: DbLogin): LoginDump => ({
      ...login,
      children: this.getLoginsByParent(login).map(login => makeTree(login))
    })
    return makeTree(login)
  }
}

/**
 * Recursively builds up a login reply tree,
 * which the server sends back in response to a v2 login request.
 */
export function makeLoginPayload(db: FakeDb, login: DbLogin): LoginPayload {
  const children = db
    .getLoginsByParent(login)
    .map(child => makeLoginPayload(db, child))

  return {
    // Identity:
    appId: login.appId,
    created: login.created,
    loginId: login.loginId,

    // Nested logins:
    children,
    parentBox: login.parentBox,

    // Login methods:
    passwordAuthBox: login.passwordAuthBox,
    passwordAuthSnrp: login.passwordAuthSnrp,
    passwordBox: login.passwordBox,
    passwordKeySnrp: login.passwordKeySnrp,
    pin2Box: login.pin2Box,
    pin2KeyBox: login.pin2KeyBox,
    pin2TextBox: login.pin2TextBox,
    question2Box: login.question2Box,
    recovery2Box: login.recovery2Box,
    recovery2KeyBox: login.recovery2KeyBox,
    otpKey: login.otpKey,
    otpResetDate: login.otpResetDate,
    otpTimeout: login.otpTimeout,
    pendingVouchers: [],
    loginAuthBox: login.loginAuthBox,

    // Resources:
    keyBoxes: login.keyBoxes,
    mnemonicBox: login.mnemonicBox,
    rootKeyBox: login.rootKeyBox,
    syncKeyBox: login.syncKeyBox
  }
}
