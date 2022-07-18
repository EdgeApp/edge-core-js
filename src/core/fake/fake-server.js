// @flow

import { asMap, asMaybe, asObject, uncleaner } from 'cleaners'
import {
  type FetchRequest,
  type HttpRequest,
  type HttpResponse,
  type Serverlet,
  pickMethod,
  pickPath
} from 'serverlet'

import { type VoucherDump } from '../../types/fake-types.js'
import {
  asChangeOtpPayload,
  asChangePasswordPayload,
  asChangePin2Payload,
  asChangeRecovery2Payload,
  asChangeSecretPayload,
  asChangeUsernamePayload,
  asChangeVouchersPayload,
  asCreateKeysPayload,
  asCreateLoginPayload,
  asEdgeBox,
  asEdgeLobbyReply,
  asEdgeLobbyRequest,
  asLobbyPayload,
  asLoginPayload,
  asLoginRequestBody,
  asMessagesPayload,
  asOtpResetPayload,
  asRecovery2InfoPayload,
  asUsernameInfoPayload
} from '../../types/server-cleaners.js'
import {
  type LoginRequestBody,
  type MessagesPayload
} from '../../types/server-types.js'
import { checkTotp } from '../../util/crypto/hotp.js'
import { verifyData } from '../../util/crypto/verify.js'
import { utf8 } from '../../util/encoding.js'
import { addHiddenProperties, softCat } from '../../util/util.js'
import { userIdSnrp } from '../scrypt/scrypt-selectors.js'
import {
  type DbLobby,
  type DbLogin,
  type DbRepo,
  type FakeDb,
  makeLoginPayload,
  makePendingVouchers
} from './fake-db.js'
import {
  jsonResponse,
  otpErrorResponse,
  passwordErrorResponse,
  payloadResponse,
  statusCodes,
  statusResponse
} from './fake-responses.js'

const wasLobbyPayload = uncleaner(asLobbyPayload)
const wasLoginPayload = uncleaner(asLoginPayload)
const wasMessagesPayload = uncleaner(asMessagesPayload)
const wasOtpResetPayload = uncleaner(asOtpResetPayload)
const wasRecovery2InfoPayload = uncleaner(asRecovery2InfoPayload)
const wasUsernameInfoPayload = uncleaner(asUsernameInfoPayload)

type DbRequest = HttpRequest & {
  +db: FakeDb,
  +json: mixed
}
type ApiRequest = DbRequest & {
  +body: LoginRequestBody,
  +payload: mixed
}
type LoginRequest = ApiRequest & {
  +login: DbLogin
}
type LobbyIdRequest = ApiRequest & {
  +lobbyId: string
}
type RepoRequest = DbRequest & {
  +repo: DbRepo
}

// Authentication middleware: ----------------------------------------------

const withApiKey = (
  server: Serverlet<ApiRequest>
): Serverlet<DbRequest> => async request => {
  const { json } = request
  const body = asMaybe(asLoginRequestBody)(json)
  if (body == null) return statusResponse(statusCodes.invalidRequest)
  return await server({ ...request, body, payload: body.data })
}

const withValidOtp: (
  server: Serverlet<LoginRequest>
) => Serverlet<LoginRequest> = server => async request => {
  const { body, login } = request
  const { otp, voucherAuth, voucherId } = body

  // Deactivated OTP is fine:
  const { otpKey } = login
  if (otpKey == null) return await server(request)

  // A valid OTP is good:
  if (otp != null && checkTotp(otpKey, otp, { spread: 2 })) {
    return await server(request)
  }

  // An approved voucher is good:
  if (voucherAuth != null && voucherId != null) {
    const voucher = login.vouchers.find(
      voucher => voucher.voucherId === voucherId
    )
    if (
      voucher != null &&
      voucher.status === 'approved' &&
      verifyData(voucherAuth, voucher.voucherAuth)
    ) {
      return await server(request)
    }
  }

  login.otpResetAuth = 'Super secret reset token'
  const voucher: VoucherDump = {
    activates: new Date('2020-01-01T00:00:00Z'),
    created: new Date('2020-01-08T00:00:00Z'),
    deviceDescription: 'A phone',
    ip: 'localhost',
    ipDescription: 'here',
    loginId: login.loginId,
    status: 'pending',
    voucherAuth: Uint8Array.from([0xaa, 0xbb]),
    voucherId: `voucher-${login.vouchers.length}`
  }
  login.vouchers.push(voucher)
  return otpErrorResponse(login, { voucher })
}

const handleMissingCredentials: Serverlet<ApiRequest> = request =>
  statusResponse(statusCodes.invalidRequest)

/**
 * Verifies that the request contains valid v2 authentication.
 */
const withLogin2 = (
  server: Serverlet<LoginRequest>,
  fallback: Serverlet<ApiRequest> = handleMissingCredentials
): Serverlet<ApiRequest> => request => {
  const { db, body } = request
  const {
    loginAuth,
    loginId,
    passwordAuth,
    pin2Auth,
    pin2Id,
    recovery2Auth,
    recovery2Id,
    userId
  } = body

  // Token login:
  if (loginId != null && loginAuth != null) {
    const login = db.getLoginById(loginId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (login.loginAuth == null || !verifyData(loginAuth, login.loginAuth)) {
      return passwordErrorResponse(0)
    }
    return withValidOtp(server)({ ...request, login })
  }

  // Password login:
  if (userId != null && passwordAuth != null) {
    const login = db.getLoginByUserId(userId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (
      login.passwordAuth == null ||
      !verifyData(passwordAuth, login.passwordAuth)
    ) {
      return passwordErrorResponse(0)
    }
    return withValidOtp(server)({ ...request, login })
  }

  // PIN2 login:
  if (pin2Id != null && pin2Auth != null) {
    const login = db.getLoginByPin2Id(pin2Id)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (login.pin2Auth == null || !verifyData(pin2Auth, login.pin2Auth)) {
      return passwordErrorResponse(0)
    }
    return withValidOtp(server)({ ...request, login })
  }

  // Recovery2 login:
  if (recovery2Id != null && recovery2Auth != null) {
    const login = db.getLoginByRecovery2Id(recovery2Id)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    const serverAuth = login.recovery2Auth
    const clientAuth = recovery2Auth
    if (serverAuth == null || clientAuth.length !== serverAuth.length) {
      return passwordErrorResponse(0)
    }
    for (let i = 0; i < clientAuth.length; ++i) {
      if (!verifyData(clientAuth[i], serverAuth[i])) {
        return passwordErrorResponse(0)
      }
    }
    return withValidOtp(server)({ ...request, login })
  }

  return fallback(request)
}

// login v2: ---------------------------------------------------------------

const loginRoute = withLogin2(
  // Authenticated version:
  request => {
    const { db, login } = request
    return payloadResponse(wasLoginPayload(makeLoginPayload(db, login)))
  },
  // Fallback version:
  request => {
    const { db, json } = request
    const clean = asLoginRequestBody(json)
    const { userId, passwordAuth, recovery2Id, recovery2Auth } = clean

    if (userId != null && passwordAuth == null) {
      const login = db.getLoginByUserId(userId)
      if (login == null) {
        return statusResponse(statusCodes.noAccount)
      }
      const { passwordAuthSnrp = userIdSnrp } = login
      return payloadResponse(wasUsernameInfoPayload({ passwordAuthSnrp }))
    }
    if (recovery2Id != null && recovery2Auth == null) {
      const login = db.getLoginByRecovery2Id(recovery2Id)
      if (login == null) {
        return statusResponse(statusCodes.noAccount)
      }
      const { question2Box } = login
      if (question2Box == null) {
        return statusResponse(statusCodes.noAccount)
      }
      return payloadResponse(wasRecovery2InfoPayload({ question2Box }))
    }
    return statusResponse(statusCodes.invalidRequest)
  }
)

function createLogin(
  request: ApiRequest,
  login?: DbLogin
): Promise<HttpResponse> {
  const { db, json } = request
  const date = new Date()

  const body = asMaybe(asLoginRequestBody)(json)
  if (body == null) return statusResponse(statusCodes.invalidRequest)
  const clean = asMaybe(asCreateLoginPayload)(body.data)
  const secret = asMaybe(asChangeSecretPayload)(clean)
  if (clean == null || secret == null) {
    return statusResponse(statusCodes.invalidRequest)
  }

  // Do not re-create accounts:
  if (db.getLoginById(clean.loginId) != null) {
    return statusResponse(statusCodes.accountExists)
  }

  // Set up repos:
  const emptyKeys = { newSyncKeys: [], keyBoxes: [] }
  const keys = asMaybe(asCreateKeysPayload, emptyKeys)(clean)
  for (const syncKey of keys.newSyncKeys) {
    db.repos[syncKey] = {}
  }

  // Start building the new database row:
  const row: DbLogin = {
    // Required fields:
    ...clean,
    ...secret,
    created: date,
    keyBoxes: keys.keyBoxes,
    vouchers: [],

    // Optional fields:
    ...asMaybe(asChangeOtpPayload)(clean),
    ...asMaybe(asChangePasswordPayload)(clean),
    ...asMaybe(asChangePin2Payload)(clean),
    ...asMaybe(asChangeRecovery2Payload)(clean),
    ...asMaybe(asChangeUsernamePayload)(clean)
  }

  // Set up the parent/child relationship:
  if (login != null) {
    const children = db.getLoginsByParent(login)
    const appIdExists =
      children.find(child => child.appId === clean.appId) != null
    if (appIdExists) {
      return statusResponse(statusCodes.invalidAppId)
    }
    row.parentId = login.loginId
  }
  db.insertLogin(row)

  return statusResponse(statusCodes.created, 'Account created')
}

const createLoginRoute = withLogin2(
  request => createLogin(request, request.login),
  request => createLogin(request)
)

const addKeysRoute = withLogin2(request => {
  const { db, login, payload } = request
  const clean = asMaybe(asCreateKeysPayload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  // Set up repos:
  for (const syncKey of clean.newSyncKeys) {
    db.repos[syncKey] = {}
  }
  login.keyBoxes = softCat(login.keyBoxes, clean.keyBoxes)

  return statusResponse()
})

const changeOtpRoute = withLogin2(request => {
  const { login, payload } = request
  const clean = asMaybe(asChangeOtpPayload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  login.otpKey = clean.otpKey
  login.otpTimeout = clean.otpTimeout
  login.otpResetDate = undefined

  return statusResponse()
})

const deleteOtpRoute = withLogin2(
  // Authenticated version:
  request => {
    const { login } = request
    login.otpKey = undefined
    login.otpResetAuth = undefined
    login.otpResetDate = undefined
    login.otpTimeout = undefined

    return statusResponse()
  },
  // Fallback version:
  request => {
    const { db, json } = request
    const clean = asLoginRequestBody(json)
    if (clean.userId == null || clean.otpResetAuth == null) {
      return statusResponse(statusCodes.invalidRequest)
    }
    const login = db.getLoginByUserId(clean.userId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (clean.otpResetAuth !== login.otpResetAuth) {
      return passwordErrorResponse(0)
    }
    const { otpKey, otpTimeout } = login
    if (otpKey == null || otpTimeout == null) {
      return statusResponse(
        statusCodes.invalidRequest,
        'OTP not setup for this account.'
      )
    }
    if (login.otpResetDate == null) {
      login.otpResetDate = new Date(Date.now() + 1000 * otpTimeout)
    }
    return payloadResponse(
      wasOtpResetPayload({ otpResetDate: login.otpResetDate })
    )
  }
)

const deletePasswordRoute = withLogin2(request => {
  const { login } = request
  login.passwordAuth = undefined
  login.passwordAuthBox = undefined
  login.passwordAuthSnrp = undefined
  login.passwordBox = undefined
  login.passwordKeySnrp = undefined

  return statusResponse()
})

const changePasswordRoute = withLogin2(request => {
  const { login, payload } = request
  const clean = asMaybe(asChangePasswordPayload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  login.passwordAuth = clean.passwordAuth
  login.passwordAuthBox = clean.passwordAuthBox
  login.passwordAuthSnrp = clean.passwordAuthSnrp
  login.passwordBox = clean.passwordBox
  login.passwordKeySnrp = clean.passwordKeySnrp

  return statusResponse()
})

const deletePin2Route = withLogin2(request => {
  const { login } = request
  login.pin2Auth = undefined
  login.pin2Box = undefined
  login.pin2Id = undefined
  login.pin2KeyBox = undefined
  login.pin2TextBox = undefined

  return statusResponse()
})

const changePin2Route = withLogin2(request => {
  const { login, payload } = request
  const clean = asMaybe(asChangePin2Payload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  login.pin2Auth = clean.pin2Auth
  login.pin2Box = clean.pin2Box
  login.pin2Id = clean.pin2Id
  login.pin2KeyBox = clean.pin2KeyBox
  login.pin2TextBox = clean.pin2TextBox

  return statusResponse()
})

const deleteRecovery2Route = withLogin2(request => {
  const { login } = request
  login.question2Box = undefined
  login.recovery2Auth = undefined
  login.recovery2Box = undefined
  login.recovery2Id = undefined
  login.recovery2KeyBox = undefined

  return statusResponse()
})

const changeRecovery2Route = withLogin2(request => {
  const { login, payload } = request
  const clean = asMaybe(asChangeRecovery2Payload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  login.question2Box = clean.question2Box
  login.recovery2Auth = clean.recovery2Auth
  login.recovery2Box = clean.recovery2Box
  login.recovery2Id = clean.recovery2Id
  login.recovery2KeyBox = clean.recovery2KeyBox

  return statusResponse()
})

const secretRoute = withLogin2(request => {
  const { db, login, payload } = request
  const clean = asMaybe(asChangeSecretPayload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  // Do a quick sanity check:
  if (login.loginAuth != null) {
    return statusResponse(
      statusCodes.conflict,
      'The secret-key login is already configured'
    )
  }

  login.loginAuth = clean.loginAuth
  login.loginAuthBox = clean.loginAuthBox

  return payloadResponse(wasLoginPayload(makeLoginPayload(db, login)))
})

export const vouchersRoute = withLogin2(async request => {
  const { db, login, payload } = request
  const clean = asMaybe(asChangeVouchersPayload)(payload)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)
  const { approvedVouchers = [], rejectedVouchers = [] } = clean

  // Let's get our tasks organized:
  const table: { [id: string]: 'approved' | 'rejected' } = {}
  for (const id of approvedVouchers) table[id] = 'approved'
  for (const id of rejectedVouchers) table[id] = 'rejected'

  // Grab all the rows:
  for (const voucher of login.vouchers) {
    if (table[voucher.voucherId] == null) continue
    voucher.status = table[voucher.voucherId]
  }

  return payloadResponse(wasLoginPayload(await makeLoginPayload(db, login)))
})

// lobby: ------------------------------------------------------------------

const handleMissingLobby: Serverlet<LobbyIdRequest> = request =>
  statusResponse(statusCodes.noLobby, `Cannot find lobby ${request.lobbyId}`)

const withLobby = (
  server: Serverlet<LobbyIdRequest & { lobby: DbLobby }>,
  fallback: Serverlet<LobbyIdRequest> = handleMissingLobby
): Serverlet<ApiRequest> => request => {
  const { db, path } = request
  const lobbyId = path.split('/')[4]
  const lobby = db.lobbies[lobbyId]
  return lobby != null
    ? server({ ...request, lobby, lobbyId })
    : fallback({ ...request, lobbyId })
}

const createLobbyRoute = withLobby(
  request =>
    statusResponse(
      statusCodes.accountExists,
      `Lobby ${request.lobbyId} already exists.`
    ),
  request => {
    const { db, json, lobbyId } = request

    const body = asMaybe(asLoginRequestBody)(json)
    if (body == null) return statusResponse(statusCodes.invalidRequest)
    const clean = asMaybe(asEdgeLobbyRequest)(body.data)
    if (clean == null) return statusResponse(statusCodes.invalidRequest)

    const { timeout = 600 } = clean
    const expires = new Date(Date.now() + 1000 * timeout).toISOString()

    db.lobbies[lobbyId] = { request: clean, replies: [], expires }
    return statusResponse()
  }
)

const updateLobbyRoute = withLobby(request => {
  const { json, lobby } = request

  const body = asMaybe(asLoginRequestBody)(json)
  if (body == null) return statusResponse(statusCodes.invalidRequest)
  const clean = asMaybe(asEdgeLobbyReply)(body.data)
  if (clean == null) return statusResponse(statusCodes.invalidRequest)

  lobby.replies.push(clean)
  return statusResponse()
})

const getLobbyRoute = withLobby(request => {
  const { lobby } = request
  return payloadResponse(wasLobbyPayload(lobby))
})

const deleteLobbyRoute = withLobby(request => {
  const { db, lobbyId } = request
  delete db.lobbies[lobbyId]
  return statusResponse()
})

// messages: ---------------------------------------------------------------

const messagesRoute: Serverlet<ApiRequest> = request => {
  const { db, json } = request
  const clean = asMaybe(asLoginRequestBody)(json)
  if (clean == null || clean.loginIds == null) {
    return statusResponse(statusCodes.invalidRequest)
  }
  const { loginIds } = clean

  const out: MessagesPayload = []
  for (const loginId of loginIds) {
    const login = db.getLoginById(loginId)
    if (login != null) {
      out.push({
        loginId,
        otpResetPending: login.otpResetDate != null,
        pendingVouchers: makePendingVouchers(login),
        recovery2Corrupt: false
      })
    }
  }
  return payloadResponse(wasMessagesPayload(out))
}

// sync: -------------------------------------------------------------------

const withRepo = (
  server: Serverlet<RepoRequest>
): Serverlet<DbRequest> => request => {
  const { db, path } = request
  const elements = path.split('/')
  const syncKey = elements[4]
  // const hash = elements[5]

  const repo = db.repos[syncKey]
  if (repo == null) {
    // This is not the auth server, so we have a different format:
    return jsonResponse({ msg: 'Hash not found' }, { status: 404 })
  }

  return server({ ...request, repo })
}

const storeReadRoute = withRepo(request => {
  const { repo } = request
  return jsonResponse({ changes: repo })
})

const storeUpdateRoute = withRepo(request => {
  const { json, repo } = request
  const { changes } = asStoreBody(json)
  for (const change of Object.keys(changes)) {
    repo[change] = changes[change]
  }
  return jsonResponse({
    changes: repo,
    hash: '1111111111111111111111111111111111111111'
  })
})

const asStoreBody = asObject({
  changes: asMap(asEdgeBox)
})

// info: -------------------------------------------------------------------

const infoRoute: Serverlet<DbRequest> = request => {
  return jsonResponse({
    infoServers: ['https://info-fake1.edge.app'],
    syncServers: [
      'https://sync-fake1.edge.app',
      'https://sync-fake2.edge.app',
      'https://sync-fake3.edge.app'
    ]
  })
}

// router: -----------------------------------------------------------------

const urls: Serverlet<DbRequest> = pickPath(
  {
    // Login v2 endpoints:
    '/api/v2/login/?': pickMethod({
      GET: withApiKey(loginRoute),
      POST: withApiKey(loginRoute)
    }),
    '/api/v2/login/create/?': pickMethod({
      POST: withApiKey(createLoginRoute),
      PUT: withApiKey(createLoginRoute)
    }),
    '/api/v2/login/keys/?': pickMethod({
      POST: withApiKey(addKeysRoute)
    }),
    '/api/v2/login/otp/?': pickMethod({
      DELETE: withApiKey(deleteOtpRoute),
      POST: withApiKey(changeOtpRoute),
      PUT: withApiKey(changeOtpRoute)
    }),
    '/api/v2/login/password/?': pickMethod({
      DELETE: withApiKey(deletePasswordRoute),
      POST: withApiKey(changePasswordRoute),
      PUT: withApiKey(changePasswordRoute)
    }),
    '/api/v2/login/pin2/?': pickMethod({
      DELETE: withApiKey(deletePin2Route),
      POST: withApiKey(changePin2Route),
      PUT: withApiKey(changePin2Route)
    }),
    '/api/v2/login/recovery2/?': pickMethod({
      DELETE: withApiKey(deleteRecovery2Route),
      POST: withApiKey(changeRecovery2Route),
      PUT: withApiKey(changeRecovery2Route)
    }),
    '/api/v2/login/secret/?': pickMethod({
      POST: withApiKey(secretRoute)
    }),
    '/api/v2/login/vouchers/?': pickMethod({
      POST: withApiKey(vouchersRoute)
    }),
    '/api/v2/messages/?': pickMethod({
      POST: withApiKey(messagesRoute)
    }),

    // Lobby server endpoints:
    '/api/v2/lobby/[^/]+/?': pickMethod({
      DELETE: withApiKey(deleteLobbyRoute),
      GET: withApiKey(getLobbyRoute),
      POST: withApiKey(updateLobbyRoute),
      PUT: withApiKey(createLobbyRoute)
    }),

    // Sync server endpoints:
    '/api/v2/store/[^/]+/?': pickMethod({
      GET: storeReadRoute,
      POST: storeUpdateRoute
    }),

    // Info server endpoints:
    '/v1/edgeServers': pickMethod({
      GET: infoRoute
    })
  },
  request =>
    statusResponse(statusCodes.notFound, `Unknown API endpoint ${request.path}`)
)

/**
 * Binds the fake server to a particular db instance.
 */
export function makeFakeServer(
  db: FakeDb
): Serverlet<FetchRequest> & { offline: boolean } {
  const serveRequest: Serverlet<FetchRequest> = request => {
    if (out.offline) throw new Error('Fake network error')
    const json =
      request.body.byteLength > 0
        ? JSON.parse(utf8.stringify(new Uint8Array(request.body)))
        : {}
    return urls({ ...request, db, json })
  }
  const out = addHiddenProperties(serveRequest, { offline: false })
  return out
}
