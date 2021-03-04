// @flow

import {
  type Cleaner,
  asArray,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

import {
  asBase64,
  asEdgeBox,
  asEdgeSnrp,
  asRecovery2Auth,
  makeLoginJson
} from '../../types/server-cleaners.js'
import {
  type EdgeBox,
  type EdgeLobbyReply,
  type EdgeLobbyRequest,
  type EdgeSnrp,
  type LoginPayload
} from '../../types/server-types.js'
import { type EdgeFakeUser } from '../../types/types.js'

export type DbLobby = {
  expires: string, // date
  request: EdgeLobbyRequest,
  replies: EdgeLobbyReply[]
}

export type DbLogin = {
  // Identity:
  appId: string,
  loginId: string, // base64
  parent?: string, // loginId
  parentBox?: EdgeBox,

  // Key login:
  loginAuth?: Uint8Array,
  loginAuthBox?: EdgeBox,

  // Password login:
  passwordAuth?: string,
  passwordAuthBox?: EdgeBox,
  passwordAuthSnrp?: EdgeSnrp,
  passwordBox?: EdgeBox,
  passwordKeySnrp?: EdgeSnrp,

  // PIN v2:
  pin2Id?: string, // base64
  pin2Auth?: Uint8Array,
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox?: EdgeBox,

  // Login Recovery v2:
  recovery2Id?: string, // base64
  recovery2Auth?: Uint8Array[],
  recovery2Box?: EdgeBox,
  recovery2KeyBox?: EdgeBox,
  question2Box?: EdgeBox,

  // OTP goodies:
  otpKey?: string,
  otpResetDate?: string, // date
  otpTimeout?: number,

  // Keys and assorted goodies:
  keyBoxes: EdgeBox[],
  mnemonicBox?: EdgeBox,
  rootKeyBox?: EdgeBox,
  syncKeyBox?: EdgeBox
}

export type DbRepo = { [path: string]: EdgeBox }

type DbLoginDump = DbLogin & { children?: DbLoginDump[] }

export const asDbLoginDump: Cleaner<DbLoginDump> = asObject({
  // Identity:
  appId: asString,
  // created: asOptional(asDate),
  loginId: asString,
  parent: asOptional(asString),

  // 2-factor:
  otpKey: asOptional(asString),
  otpResetDate: asOptional(asString), // asDate
  otpTimeout: asOptional(asNumber),
  // pendingVouchers: asOptional(asArray(asPendingVoucher), []),

  // Return logins:
  loginAuth: asOptional(asBase64),
  loginAuthBox: asOptional(asEdgeBox),
  parentBox: asOptional(asEdgeBox),

  // Password login:
  passwordAuth: asOptional(asString),
  passwordAuthBox: asOptional(asEdgeBox),
  passwordAuthSnrp: asOptional(asEdgeSnrp),
  passwordBox: asOptional(asEdgeBox),
  passwordKeySnrp: asOptional(asEdgeSnrp),

  // PIN v2 login:
  pin2Id: asOptional(asString),
  pin2Auth: asOptional(asBase64),
  pin2Box: asOptional(asEdgeBox),
  pin2KeyBox: asOptional(asEdgeBox),
  pin2TextBox: asOptional(asEdgeBox),

  // Recovery v2 login:
  recovery2Id: asOptional(asString),
  recovery2Auth: asOptional(asRecovery2Auth),
  question2Box: asOptional(asEdgeBox),
  recovery2Box: asOptional(asEdgeBox),
  recovery2KeyBox: asOptional(asEdgeBox),

  // Keys and assorted goodies:
  children: asOptional(asArray(raw => asDbLoginDump(raw))),
  keyBoxes: asOptional(asArray(asEdgeBox), []),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox),

  // Obsolete:
  pinBox: asOptional(asEdgeBox),
  pinId: asOptional(asString),
  pinKeyBox: asOptional(asEdgeBox)
})

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

  getLoginById(loginId: string): DbLogin | void {
    return this.logins.find(login => login.loginId === loginId)
  }

  getLoginByPin2Id(pin2Id: string): DbLogin | void {
    return this.logins.find(login => login.pin2Id === pin2Id)
  }

  getLoginByRecovery2Id(recovery2Id: string): DbLogin | void {
    return this.logins.find(login => login.recovery2Id === recovery2Id)
  }

  getLoginsByParent(parent: DbLogin): DbLogin[] {
    return this.logins.filter(child => child.parent === parent.loginId)
  }

  insertLogin(login: DbLogin): void {
    this.logins.push(login)
  }

  // Dumping & restoration --------------------------------------------

  setupFakeLogin(user: DbLoginDump, parent: string | void): void {
    // Fill in the database row for this login:
    const row = asDbLoginDump(user)
    row.parent = parent
    this.insertLogin(row)

    // Recurse into our children:
    if (user.children != null) {
      for (const child of user.children) {
        this.setupFakeLogin(child, user.loginId)
      }
    }
  }

  setupFakeUser(user: EdgeFakeUser): void {
    this.setupFakeLogin(user.server, undefined)

    // Create fake repos:
    for (const syncKey of Object.keys(user.repos)) {
      this.repos[syncKey] = { ...user.repos[syncKey] }
    }
  }

  dumpLogin(login: DbLogin): DbLoginDump {
    const { parent, ...rest } = login
    const out = JSON.parse(makeLoginJson(rest))
    out.children = this.getLoginsByParent(login).map(child =>
      this.dumpLogin(child)
    )
    return out
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
    loginId: login.loginId,
    parentBox: login.parentBox,

    // Login methods:
    loginAuthBox: login.loginAuthBox,
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
    otpResetDate:
      login.otpResetDate != null ? new Date(login.otpResetDate) : undefined,
    otpTimeout: login.otpTimeout,
    pendingVouchers: [],

    // Resources:
    keyBoxes: login.keyBoxes,
    mnemonicBox: login.mnemonicBox,
    rootKeyBox: login.rootKeyBox,
    syncKeyBox: login.syncKeyBox,
    children
  }
}
