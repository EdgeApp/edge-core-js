// @flow

import { checkTotp } from '../../util/crypto/hotp.js'
import { type HttpResponse } from '../../util/http/http-types.js'
import { filterObject, softCat } from '../../util/util.js'
import { loginCreateColumns } from './fake-db.js'
import { type FakeRequest, addRoute } from './fake-fetch.js'
import {
  jsonResponse,
  loginResponse,
  otpErrorResponse,
  passwordErrorResponse,
  statusCodes,
  statusResponse
} from './fake-responses.js'

const OTP_RESET_TOKEN = 'Super secret reset token'

// Authentication middleware: ----------------------------------------------

/**
 * Verifies that the request contains valid v1 authentication.
 */
function authHandler1(req: FakeRequest) {
  // Password login:
  if (req.body.l1 != null && req.body.lp1 != null) {
    const login = this.findLoginId(req.body.l1)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (req.body.lp1 !== login.passwordAuth) {
      return passwordErrorResponse(0)
    }
    req.login = login
    return
  }
  return statusResponse(statusCodes.invalidRequest)
}

/**
 * Verifies that the request contains valid v2 authentication.
 */
function authHandler(req: FakeRequest) {
  // Token login:
  if (req.body.loginId != null && req.body.loginAuth != null) {
    const login = this.findLoginId(req.body.loginId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (req.body.loginAuth !== login.loginAuth) {
      return passwordErrorResponse(0)
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    req.login = login
    return
  }

  // Password login:
  if (req.body.userId != null && req.body.passwordAuth != null) {
    const login = this.findLoginId(req.body.userId)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (req.body.passwordAuth !== login.passwordAuth) {
      return passwordErrorResponse(0)
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    req.login = login
    return
  }

  // PIN2 login:
  if (req.body.pin2Id != null && req.body.pin2Auth != null) {
    const login = this.findPin2Id(req.body.pin2Id)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    if (req.body.pin2Auth !== login.pin2Auth) {
      return passwordErrorResponse(0)
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    req.login = login
    return
  }

  // Recovery2 login:
  if (req.body.recovery2Id != null && req.body.recovery2Auth != null) {
    const login = this.findRecovery2Id(req.body.recovery2Id)
    if (login == null) {
      return statusResponse(statusCodes.noAccount)
    }
    const serverAuth = login.recovery2Auth
    const clientAuth = req.body.recovery2Auth
    if (clientAuth.length !== serverAuth.length) {
      return passwordErrorResponse(0)
    }
    for (let i = 0; i < clientAuth.length; ++i) {
      if (clientAuth[i] !== serverAuth[i]) {
        return passwordErrorResponse(0)
      }
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return otpErrorResponse(OTP_RESET_TOKEN)
    }
    req.login = login
    return
  }

  return statusResponse(statusCodes.invalidRequest)
}

// Account lifetime v1: ----------------------------------------------------

addRoute('POST', '/api/v1/account/available', function(req: FakeRequest) {
  if (typeof req.body.l1 !== 'string') {
    return statusResponse(statusCodes.invalidRequest)
  }
  if (this.findLoginId(req.body.l1)) {
    return statusResponse(statusCodes.accountExists)
  }
  return statusResponse(statusCodes.success, 'Account available')
})

addRoute('POST', '/api/v1/account/create', function(req: FakeRequest) {
  if (this.findLoginId(req.body.l1)) {
    return statusResponse(statusCodes.accountExists)
  }

  const carePackage = JSON.parse(req.body.care_package)
  const loginPackage = JSON.parse(req.body.login_package)
  this.db.logins.push({
    appId: '',
    loginId: req.body.l1,
    passwordAuth: req.body.lp1,
    passwordKeySnrp: carePackage.SNRP2,
    passwordAuthBox: loginPackage.ELP1,
    passwordBox: loginPackage.EMK_LP2,
    syncKeyBox: loginPackage.ESyncKey
  })
  this.repos[req.body.repo_account_key] = {}

  return statusResponse(statusCodes.created, 'Account created')
})

addRoute('POST', '/api/v1/account/activate', authHandler1, function(
  req: FakeRequest
) {
  return statusResponse(statusCodes.success, 'Account activated')
})

// Login v1: ---------------------------------------------------------------

addRoute('POST', '/api/v1/account/carepackage/get', function(req: FakeRequest) {
  const login = this.findLoginId(req.body.l1)
  if (login == null) {
    return statusResponse(statusCodes.noAccount)
  }

  return loginResponse({
    care_package: JSON.stringify({
      SNRP2: login.passwordKeySnrp
    })
  })
})

addRoute('POST', '/api/v1/account/loginpackage/get', authHandler1, function(
  req: FakeRequest
) {
  const results: any = {
    login_package: JSON.stringify({
      ELP1: req.login.passwordAuthBox,
      EMK_LP2: req.login.passwordBox,
      ESyncKey: req.login.syncKeyBox
    })
  }
  if (req.login.rootKeyBox != null) {
    results.rootKeyBox = req.login.rootKeyBox
  }
  return loginResponse(results)
})

addRoute('POST', '/api/v1/otp/reset', function(req: FakeRequest) {
  const login = this.findLoginId(req.body.l1)
  if (!login || req.body.otp_reset_auth !== OTP_RESET_TOKEN) {
    return statusResponse(statusCodes.invalidPassword)
  }
  if (login.otpTimeout == null || login.otpKey == null) {
    return statusResponse(
      statusCodes.invalidRequest,
      'OTP not setup for this account.'
    )
  }
  const resetDate = new Date(Date.now() + 1000 * login.otpTimeout)
  login.otpResetDate = resetDate.toISOString()
  return statusResponse(statusCodes.success, 'Reset requested')
})

// PIN login v1: -----------------------------------------------------------

addRoute('POST', '/api/v1/account/pinpackage/update', authHandler1, function(
  req: FakeRequest
) {
  this.db.pinKeyBox = JSON.parse(req.body.pin_package)
  return statusResponse()
})

addRoute('POST', '/api/v1/account/pinpackage/get', function(req: FakeRequest) {
  if (this.db.pinKeyBox == null) {
    return statusResponse(statusCodes.noAccount)
  }
  return loginResponse({
    pin_package: JSON.stringify(this.db.pinKeyBox)
  })
})

// Repo server v1: ---------------------------------------------------------

addRoute('POST', '/api/v1/wallet/create', authHandler1, function(
  req: FakeRequest
) {
  this.repos[req.body.repo_wallet_key] = {}
  return statusResponse(statusCodes.created, 'Wallet created')
})

addRoute('POST', '/api/v1/wallet/activate', authHandler1, function(
  req: FakeRequest
) {
  return statusResponse(statusCodes.success, 'Wallet updated')
})

// login v2: ---------------------------------------------------------------

addRoute(
  'POST',
  '/api/v2/login',
  function(req: FakeRequest) {
    if (req.body.userId != null && req.body.passwordAuth == null) {
      const login = this.findLoginId(req.body.userId)
      if (login == null) {
        return statusResponse(statusCodes.noAccount)
      }
      return loginResponse({
        passwordAuthSnrp: login.passwordAuthSnrp
      })
    }
    if (req.body.recovery2Id != null && req.body.recovery2Auth == null) {
      const login = this.findRecovery2Id(req.body.recovery2Id)
      if (login == null) {
        return statusResponse(statusCodes.noAccount)
      }
      return loginResponse({
        question2Box: login.question2Box
      })
    }
    return undefined
  },
  authHandler,
  function(req: FakeRequest) {
    return loginResponse(this.makeReply(req.login))
  }
)

addRoute('POST', '/api/v2/login/create', function(req: FakeRequest) {
  const data = req.body.data
  if (data.appId == null || data.loginId == null) {
    return statusResponse(statusCodes.invalidRequest)
  }
  if (this.db.logins.find(login => login.loginId === data.loginId)) {
    return statusResponse(statusCodes.accountExists)
  }

  // Set up repos:
  if (data.newSyncKeys != null) {
    for (const syncKey of data.newSyncKeys) {
      this.repos[syncKey] = {}
    }
  }

  // Set up login object:
  const row = filterObject(data, loginCreateColumns)
  if (req.body.loginId != null || req.body.userId != null) {
    const e = authHandler.call(this, req)
    if (e) return e

    const appIdExists = this.db.logins.find(
      login => login.parent === req.login.loginId && login.appId === data.appId
    )
    if (appIdExists) {
      return statusResponse(statusCodes.invalidAppId)
    }

    row.parent = req.login.loginId
  }
  this.db.logins.push(row)

  return statusResponse(statusCodes.created, 'Account created')
})

addRoute('POST', '/api/v2/login/keys', authHandler, function(req: FakeRequest) {
  const data = req.body.data
  if (data.keyBoxes == null) {
    return statusResponse(statusCodes.invalidRequest)
  }

  // Set up repos:
  if (data.newSyncKeys != null) {
    for (const syncKey of data.newSyncKeys) {
      this.repos[syncKey] = {}
    }
  }

  req.login.keyBoxes = softCat(req.login.keyBoxes, data.keyBoxes)

  return statusResponse()
})

addRoute('POST', '/api/v2/login/otp', authHandler, function(req: FakeRequest) {
  const data = req.body.data
  if (data.otpKey == null || data.otpTimeout == null) {
    return statusResponse(statusCodes.invalidRequest)
  }

  req.login.otpKey = data.otpKey
  req.login.otpTimeout = data.otpTimeout
  req.login.otpResetDate = undefined

  return statusResponse()
})

addRoute(
  'DELETE',
  '/api/v2/login/otp',
  function(req: FakeRequest) {
    if (req.body.userId != null && req.body.otpResetAuth != null) {
      const login = this.findLoginId(req.body.userId)
      if (login == null) {
        return statusResponse(statusCodes.noAccount)
      }
      if (req.body.otpResetAuth !== OTP_RESET_TOKEN) {
        return passwordErrorResponse(0)
      }
      if (login.otpKey == null || login.otpTimeout == null) {
        return statusResponse(
          statusCodes.invalidRequest,
          'OTP not setup for this account.'
        )
      }
      if (login.otpResetDate == null) {
        const resetDate = new Date(Date.now() + 1000 * login.otpTimeout)
        login.otpResetDate = resetDate.toISOString()
      }
      return loginResponse({
        otpResetDate: login.otpResetDate
      })
    }
  },
  authHandler,
  function(req: FakeRequest) {
    req.login.otpKey = undefined
    req.login.otpTimeout = undefined
    req.login.otpResetDate = undefined

    return statusResponse()
  }
)

addRoute('DELETE', '/api/v2/login/password', authHandler, function(
  req: FakeRequest
) {
  req.login.passwordAuth = undefined
  req.login.passwordAuthBox = undefined
  req.login.passwordAuthSnrp = undefined
  req.login.passwordBox = undefined
  req.login.passwordKeySnrp = undefined

  return statusResponse()
})

addRoute('POST', '/api/v2/login/password', authHandler, function(
  req: FakeRequest
) {
  const data = req.body.data
  if (
    data.passwordAuth == null ||
    data.passwordAuthBox == null ||
    data.passwordAuthSnrp == null ||
    data.passwordBox == null ||
    data.passwordKeySnrp == null
  ) {
    return statusResponse(statusCodes.invalidRequest)
  }

  req.login.passwordAuth = data.passwordAuth
  req.login.passwordAuthBox = data.passwordAuthBox
  req.login.passwordAuthSnrp = data.passwordAuthSnrp
  req.login.passwordBox = data.passwordBox
  req.login.passwordKeySnrp = data.passwordKeySnrp

  return statusResponse()
})

addRoute('DELETE', '/api/v2/login/pin2', authHandler, function(
  req: FakeRequest
) {
  req.login.pin2Auth = undefined
  req.login.pin2Box = undefined
  req.login.pin2Id = undefined
  req.login.pin2KeyBox = undefined
  req.login.pin2TextBox = undefined

  return statusResponse()
})

addRoute('POST', '/api/v2/login/pin2', authHandler, function(req: FakeRequest) {
  const data = req.body.data

  const enablingPin =
    data.pin2Auth != null &&
    data.pin2Box != null &&
    data.pin2Id != null &&
    data.pin2KeyBox != null
  const disablingPin =
    data.pin2Auth == null &&
    data.pin2Box == null &&
    data.pin2Id == null &&
    data.pin2KeyBox == null &&
    data.pin2TextBox != null

  if (!enablingPin && !disablingPin) {
    return statusResponse(statusCodes.invalidRequest)
  }

  req.login.pin2Auth = data.pin2Auth
  req.login.pin2Box = data.pin2Box
  req.login.pin2Id = data.pin2Id
  req.login.pin2KeyBox = data.pin2KeyBox
  req.login.pin2TextBox = data.pin2TextBox

  return statusResponse()
})

addRoute('DELETE', '/api/v2/login/recovery2', authHandler, function(
  req: FakeRequest
) {
  req.login.question2Box = undefined
  req.login.recovery2Auth = undefined
  req.login.recovery2Box = undefined
  req.login.recovery2Id = undefined
  req.login.recovery2KeyBox = undefined

  return statusResponse()
})

addRoute('POST', '/api/v2/login/recovery2', authHandler, function(
  req: FakeRequest
) {
  const data = req.body.data
  if (
    data.question2Box == null ||
    data.recovery2Auth == null ||
    data.recovery2Box == null ||
    data.recovery2Id == null ||
    data.recovery2KeyBox == null
  ) {
    return statusResponse(statusCodes.invalidRequest)
  }

  req.login.question2Box = data.question2Box
  req.login.recovery2Auth = data.recovery2Auth
  req.login.recovery2Box = data.recovery2Box
  req.login.recovery2Id = data.recovery2Id
  req.login.recovery2KeyBox = data.recovery2KeyBox

  return statusResponse()
})

// lobby: ------------------------------------------------------------------

addRoute('PUT', '/api/v2/lobby/.*', function(req: FakeRequest) {
  const lobbyId = req.path.split('/')[4]
  const lobby = this.db.lobbies[lobbyId]
  if (lobby != null) {
    return statusResponse(
      statusCodes.accountExists,
      `Lobby ${lobbyId} already exists.`
    )
  }

  this.db.lobbies[lobbyId] = { request: req.body.data, replies: [] }
  return statusResponse()
})

addRoute('POST', '/api/v2/lobby/.*', function(req: FakeRequest) {
  const lobbyId = req.path.split('/')[4]
  const lobby = this.db.lobbies[lobbyId]
  if (lobby == null) {
    return statusResponse(statusCodes.noLobby, `Cannot find lobby ${lobbyId}`)
  }

  lobby.replies.push(req.body.data)
  return statusResponse()
})

addRoute('GET', '/api/v2/lobby/.*', function(req: FakeRequest) {
  const lobbyId = req.path.split('/')[4]
  const lobby = this.db.lobbies[lobbyId]
  if (lobby == null) {
    return statusResponse(statusCodes.noLobby, `Cannot find lobby ${lobbyId}`)
  }

  return loginResponse(lobby)
})

addRoute('DELETE', '/api/v2/lobby/.*', function(req: FakeRequest) {
  const lobbyId = req.path.split('/')[4]
  const lobby = this.db.lobbies[lobbyId]
  if (lobby == null) {
    return statusResponse(statusCodes.noLobby, `Cannot find lobby ${lobbyId}`)
  }

  delete this.db.lobbies[lobbyId]
  return statusResponse()
})

// messages: ---------------------------------------------------------------

addRoute('POST', '/api/v2/messages', function(req: FakeRequest) {
  const { loginIds } = req.body

  const out = []
  for (const loginId of loginIds) {
    const login = this.findLoginId(loginId)
    if (login) {
      out.push({
        loginId,
        otpResetPending: !!login.otpResetDate,
        recovery2Corrupt: false
      })
    }
  }
  return loginResponse(out)
})

// sync: -------------------------------------------------------------------

function storeRoute(req: FakeRequest): HttpResponse | void {
  const elements = req.path.split('/')
  const syncKey = elements[4]
  // const hash = elements[5]

  const repo = this.repos[syncKey]
  if (repo == null) {
    // This is not the auth server, so we have a different format:
    return jsonResponse({ msg: 'Hash not found' }, { status: 404 })
  }

  switch (req.method) {
    case 'POST': {
      const changes = req.body.changes
      for (const change of Object.keys(changes)) {
        repo[change] = changes[change]
      }
      return jsonResponse({
        changes: repo,
        hash: '1111111111111111111111111111111111111111'
      })
    }

    case 'GET':
      return jsonResponse({ changes: repo })
  }
}

addRoute('GET', '/api/v2/store/.*', storeRoute)
addRoute('POST', '/api/v2/store/.*', storeRoute)
