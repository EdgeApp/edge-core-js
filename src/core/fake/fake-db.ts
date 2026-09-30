import { EdgeLoginDump, EdgeRepoDump } from '../../types/fake-types'
import {
  EdgeLobbyReply,
  EdgeLobbyRequest,
  LoginPayload
} from '../../types/server-types'
import { EdgePendingVoucher } from '../../types/types'
import { verifyData } from '../../util/crypto/verify'

/**
 * A barcode-login lobby stored in the fake database.
 */
export interface DbLobby {
  expires: string // date
  request: EdgeLobbyRequest
  replies: EdgeLobbyReply[]
}

/**
 * A login object stored in the fake database.
 */
export type DbLogin = Omit<EdgeLoginDump, 'children'>

/**
 * Emulates the Airbitz login server database.
 */
export class FakeDb {
  lobbies: Map<string, DbLobby>
  logins: DbLogin[]
  repos: Map<string, EdgeRepoDump>

  /** Per-repo file-version counters, keyed like `repos`. */
  repoVersions: Map<string, number>

  /** Called with the sync key of every repo that gains changes. */
  repoListeners: Set<(syncKey: string) => void>

  constructor() {
    this.lobbies = new Map()
    this.logins = []
    this.repos = new Map()
    this.repoVersions = new Map()
    this.repoListeners = new Set()
  }

  /**
   * The repo's checkpoint, in the sync server's `<version>:<sum>` form.
   * The fake counts one version per file written, so the checkpoint
   * moves whenever the repo changes.
   */
  getRepoCheckpoint(syncKey: string): string {
    const version = this.repoVersions.get(syncKey) ?? 0
    return `${version}:${version}`
  }

  /** Records a write to a repo and tells the listeners. */
  touchRepo(syncKey: string, fileCount: number): void {
    if (fileCount <= 0) return
    const version = this.repoVersions.get(syncKey) ?? 0
    this.repoVersions.set(syncKey, version + fileCount)
    this.repoListeners.forEach(listener => listener(syncKey))
  }

  getLoginById(loginId: Uint8Array): DbLogin | undefined {
    return this.logins.find(login => verifyData(login.loginId, loginId))
  }

  getLoginByUserId(userId: Uint8Array): DbLogin | undefined {
    return this.logins.find(login =>
      login.userId == null
        ? verifyData(login.loginId, userId)
        : verifyData(login.userId, userId)
    )
  }

  getLoginByPin2Id(pin2Id: Uint8Array): DbLogin | undefined {
    return this.logins.find(
      login => login.pin2Id != null && verifyData(login.pin2Id, pin2Id)
    )
  }

  getLoginByRecovery2Id(recovery2Id: Uint8Array): DbLogin | undefined {
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

  setupLogin(dump: EdgeLoginDump): void {
    const { children, ...rest } = dump
    this.insertLogin(rest)
    for (const child of children) {
      child.parentId = dump.loginId
      this.setupLogin(child)
    }
  }

  setupRepo(syncKey: string, repo: EdgeRepoDump): void {
    this.repos.set(syncKey, repo)
    this.repoVersions.set(syncKey, Object.keys(repo).length)
  }

  dumpLogin(login: DbLogin): EdgeLoginDump {
    const makeTree = (login: DbLogin): EdgeLoginDump => ({
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
    pendingVouchers: makePendingVouchers(login),
    loginAuthBox: login.loginAuthBox,

    // Username:
    userId: login.userId,
    userTextBox: login.userTextBox,

    // Resources:
    keyBoxes: login.keyBoxes,
    mnemonicBox: login.mnemonicBox,
    rootKeyBox: login.rootKeyBox,
    syncKeyBox: login.syncKeyBox
  }
}

export function makePendingVouchers(login: DbLogin): EdgePendingVoucher[] {
  return login.vouchers
    .filter(voucher => voucher.status === 'pending')
    .map(voucher => ({
      activates: voucher.activates,
      created: voucher.created,
      deviceDescription: voucher.deviceDescription,
      ip: voucher.ip,
      ipDescription: voucher.ipDescription,
      voucherId: voucher.voucherId
    }))
}
