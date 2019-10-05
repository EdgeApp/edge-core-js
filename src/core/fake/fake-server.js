import { checkTotp } from '../../util/crypto/hotp.js'
import { filterObject, softCat } from '../../util/util.js'
import { loginCreateColumns } from './fake-db.js'
import { addRoute, FakeResponse } from './fake-fetch.js'

const OTP_RESET_TOKEN = 'Super secret reset token'

const errorCodes = {
  success: 0,
  error: 1,
  accountExists: 2,
  noAccount: 3,
  invalidPassword: 4,
  invalidAnswers: 5,
  invalidApiKey: 6,
  invalidOtp: 8,
  conflict: 10,
  obsolete: 1000
}

function makeResponse(results) {
  const reply = {
    status_code: 0
  }
  if (results != null) {
    reply.results = results
  }
  return new FakeResponse(JSON.stringify(reply))
}

function makeErrorResponse(code, message = '', status = 500) {
  const body = {
    status_code: code,
    message: message || 'Server error'
  }
  return new FakeResponse(JSON.stringify(body), { status })
}

function makeOtpErrorResponse(status = 500) {
  const body = {
    status_code: errorCodes.invalidOtp,
    message: 'OTP error',
    results: {
      otp_reset_auth: OTP_RESET_TOKEN
    }
  }
  return new FakeResponse(JSON.stringify(body), { status })
}

// Authentication middleware: ----------------------------------------------

/**
 * Verifies that the request contains valid v1 authenticaion.
 */
function authHandler1(req) {
  // Password login:
  if (req.body.l1 != null && req.body.lp1 != null) {
    const login = this.findLoginId(req.body.l1)
    if (login == null) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.lp1 !== login.passwordAuth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    req.login = login
    return
  }
  return makeErrorResponse(errorCodes.error, 'Missing credentials')
}

/**
 * Verifies that the request contains valid v2 authenticaion.
 */
function authHandler(req) {
  // Token login:
  if (req.body.loginId != null && req.body.loginAuth != null) {
    const login = this.findLoginId(req.body.loginId)
    if (login == null) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.loginAuth !== login.loginAuth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return makeOtpErrorResponse()
    }
    req.login = login
    return
  }

  // Password login:
  if (req.body.userId != null && req.body.passwordAuth != null) {
    const login = this.findLoginId(req.body.userId)
    if (login == null) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.passwordAuth !== login.passwordAuth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return makeOtpErrorResponse()
    }
    req.login = login
    return
  }

  // PIN2 login:
  if (req.body.pin2Id != null && req.body.pin2Auth != null) {
    const login = this.findPin2Id(req.body.pin2Id)
    if (login == null) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.pin2Auth !== login.pin2Auth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return makeOtpErrorResponse()
    }
    req.login = login
    return
  }

  // Recovery2 login:
  if (req.body.recovery2Id != null && req.body.recovery2Auth != null) {
    const login = this.findRecovery2Id(req.body.recovery2Id)
    if (login == null) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    const serverAuth = login.recovery2Auth
    const clientAuth = req.body.recovery2Auth
    if (clientAuth.length !== serverAuth.length) {
      return makeErrorResponse(errorCodes.invalidAnswers)
    }
    for (let i = 0; i < clientAuth.length; ++i) {
      if (clientAuth[i] !== serverAuth[i]) {
        return makeErrorResponse(errorCodes.invalidAnswers)
      }
    }
    if (login.otpKey && !checkTotp(login.otpKey, req.body.otp)) {
      return makeOtpErrorResponse()
    }
    req.login = login
    return
  }
  return makeErrorResponse(errorCodes.error, 'Missing credentials')
}

// Account lifetime v1: ----------------------------------------------------

addRoute('POST', '/api/v1/account/available', function(req) {
  if (this.findLoginId(req.body.l1)) {
    return makeErrorResponse(errorCodes.accountExists)
  }
  return makeResponse()
})

addRoute('POST', '/api/v1/account/create', function(req) {
  if (this.findLoginId(req.body.l1)) {
    return makeErrorResponse(errorCodes.accountExists)
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

  return makeResponse()
})

addRoute('POST', '/api/v1/account/activate', authHandler1, function(req) {
  return makeResponse()
})

// Login v1: ---------------------------------------------------------------

addRoute('POST', '/api/v1/account/carepackage/get', function(req) {
  const login = this.findLoginId(req.body.l1)
  if (login == null) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  return makeResponse({
    care_package: JSON.stringify({
      SNRP2: login.passwordKeySnrp
    })
  })
})

addRoute('POST', '/api/v1/account/loginpackage/get', authHandler1, function(
  req
) {
  const results = {
    login_package: JSON.stringify({
      ELP1: req.login.passwordAuthBox,
      EMK_LP2: req.login.passwordBox,
      ESyncKey: req.login.syncKeyBox
    })
  }
  if (req.login.rootKeyBox != null) {
    results.rootKeyBox = req.login.rootKeyBox
  }
  return makeResponse(results)
})

addRoute('POST', '/api/v1/otp/reset', function(req) {
  const login = this.findLoginId(req.body.l1)
  if (!login || req.body.otp_reset_auth !== OTP_RESET_TOKEN) {
    return makeErrorResponse(errorCodes.invalidOtp)
  }
  const resetDate = new Date(Date.now() + 1000 * login.otpTimeout)
  login.otpResetDate = resetDate.toISOString()
  return makeResponse()
})

// PIN login v1: -----------------------------------------------------------

addRoute('POST', '/api/v1/account/pinpackage/update', authHandler1, function(
  req
) {
  this.db.pinKeyBox = JSON.parse(req.body.pin_package)
  return makeResponse()
})

addRoute('POST', '/api/v1/account/pinpackage/get', function(req) {
  if (this.db.pinKeyBox == null) {
    return makeErrorResponse(errorCodes.noAccount)
  }
  return makeResponse({
    pin_package: JSON.stringify(this.db.pinKeyBox)
  })
})

// Repo server v1: ---------------------------------------------------------

addRoute('POST', '/api/v1/wallet/create', authHandler1, function(req) {
  this.repos[req.body.repo_wallet_key] = {}
  return makeResponse()
})

addRoute('POST', '/api/v1/wallet/activate', authHandler1, function(req) {
  return makeResponse()
})

// login v2: ---------------------------------------------------------------

addRoute(
  'POST',
  '/api/v2/login',
  function(req) {
    if (req.body.userId != null && req.body.passwordAuth == null) {
      const login = this.findLoginId(req.body.userId)
      if (login == null) {
        return makeErrorResponse(errorCodes.noAccount)
      }
      return makeResponse({
        passwordAuthSnrp: login.passwordAuthSnrp
      })
    }
    if (req.body.recovery2Id != null && req.body.recovery2Auth == null) {
      const login = this.findRecovery2Id(req.body.recovery2Id)
      if (login == null) {
        return makeErrorResponse(errorCodes.noAccount)
      }
      return makeResponse({
        question2Box: login.question2Box
      })
    }
    return null
  },
  authHandler,
  function(req) {
    return makeResponse(this.makeReply(req.login))
  }
)

addRoute('POST', '/api/v2/login/create', function(req) {
  const data = req.body.data
  if (data.appId == null || data.loginId == null) {
    return makeErrorResponse(errorCodes.error)
  }
  if (this.db.logins.find(login => login.loginId === data.loginId)) {
    return makeErrorResponse(errorCodes.accountExists)
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
      return makeErrorResponse(
        errorCodes.conflict,
        'A login with the same appId already exists'
      )
    }

    row.parent = req.login.loginId
  }
  this.db.logins.push(row)

  return makeResponse()
})

addRoute('POST', '/api/v2/login/keys', authHandler, function(req) {
  const data = req.body.data
  if (data.keyBoxes == null) {
    return makeErrorResponse(errorCodes.error)
  }

  // Set up repos:
  if (data.newSyncKeys != null) {
    for (const syncKey of data.newSyncKeys) {
      this.repos[syncKey] = {}
    }
  }

  req.login.keyBoxes = softCat(req.login.keyBoxes, data.keyBoxes)

  return makeResponse()
})

addRoute('POST', '/api/v2/login/otp', authHandler, function(req) {
  const data = req.body.data
  if (data.otpKey == null || data.otpTimeout == null) {
    return makeErrorResponse(errorCodes.error)
  }

  req.login.otpKey = data.otpKey
  req.login.otpTimeout = data.otpTimeout
  req.login.otpResetDate = undefined

  return makeResponse()
})

addRoute(
  'DELETE',
  '/api/v2/login/otp',
  function(req) {
    if (req.body.userId != null && req.body.otpResetAuth != null) {
      const login = this.findLoginId(req.body.userId)
      if (login == null) {
        return makeErrorResponse(errorCodes.noAccount)
      }
      if (req.body.otpResetAuth !== OTP_RESET_TOKEN) {
        return makeErrorResponse(errorCodes.invalidPassword)
      }
      if (login.otpKey == null || login.otpTimeout == null) {
        return makeErrorResponse(
          errorCodes.error,
          'OTP is not enabled on this account'
        )
      }
      if (login.otpResetDate == null) {
        const resetDate = new Date(Date.now() + 1000 * login.otpTimeout)
        login.otpResetDate = resetDate.toISOString()
      }
      return makeResponse({
        otpResetDate: login.otpResetDate
      })
    }
  },
  authHandler,
  function(req) {
    req.login.otpKey = undefined
    req.login.otpTimeout = undefined
    req.login.otpResetDate = undefined

    return makeResponse()
  }
)

addRoute('DELETE', '/api/v2/login/password', authHandler, function(req) {
  req.login.passwordAuth = undefined
  req.login.passwordAuthBox = undefined
  req.login.passwordAuthSnrp = undefined
  req.login.passwordBox = undefined
  req.login.passwordKeySnrp = undefined

  return makeResponse()
})

addRoute('POST', '/api/v2/login/password', authHandler, function(req) {
  const data = req.body.data
  if (
    data.passwordAuth == null ||
    data.passwordAuthBox == null ||
    data.passwordAuthSnrp == null ||
    data.passwordBox == null ||
    data.passwordKeySnrp == null
  ) {
    return makeErrorResponse(errorCodes.error)
  }

  req.login.passwordAuth = data.passwordAuth
  req.login.passwordAuthBox = data.passwordAuthBox
  req.login.passwordAuthSnrp = data.passwordAuthSnrp
  req.login.passwordBox = data.passwordBox
  req.login.passwordKeySnrp = data.passwordKeySnrp

  return makeResponse()
})

addRoute('DELETE', '/api/v2/login/pin2', authHandler, function(req) {
  req.login.pin2Auth = undefined
  req.login.pin2Box = undefined
  req.login.pin2Id = undefined
  req.login.pin2KeyBox = undefined
  req.login.pin2TextBox = undefined

  return makeResponse()
})

addRoute('POST', '/api/v2/login/pin2', authHandler, function(req) {
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
    return makeErrorResponse(errorCodes.error)
  }

  req.login.pin2Auth = data.pin2Auth
  req.login.pin2Box = data.pin2Box
  req.login.pin2Id = data.pin2Id
  req.login.pin2KeyBox = data.pin2KeyBox
  req.login.pin2TextBox = data.pin2TextBox

  return makeResponse()
})

addRoute('DELETE', '/api/v2/login/recovery2', authHandler, function(req) {
  req.login.question2Box = undefined
  req.login.recovery2Auth = undefined
  req.login.recovery2Box = undefined
  req.login.recovery2Id = undefined
  req.login.recovery2KeyBox = undefined

  return makeResponse()
})

addRoute('POST', '/api/v2/login/recovery2', authHandler, function(req) {
  const data = req.body.data
  if (
    data.question2Box == null ||
    data.recovery2Auth == null ||
    data.recovery2Box == null ||
    data.recovery2Id == null ||
    data.recovery2KeyBox == null
  ) {
    return makeErrorResponse(errorCodes.error)
  }

  req.login.question2Box = data.question2Box
  req.login.recovery2Auth = data.recovery2Auth
  req.login.recovery2Box = data.recovery2Box
  req.login.recovery2Id = data.recovery2Id
  req.login.recovery2KeyBox = data.recovery2KeyBox

  return makeResponse()
})

// lobby: ------------------------------------------------------------------

addRoute('PUT', '/api/v2/lobby/.*', function(req) {
  const pubkey = req.path.split('/')[4]
  this.db.lobbies[pubkey] = { request: req.body.data, replies: [] }
  return makeResponse()
})

addRoute('POST', '/api/v2/lobby/.*', function(req) {
  const pubkey = req.path.split('/')[4]
  this.db.lobbies[pubkey].replies.push(req.body.data)
  return makeResponse()
})

addRoute('GET', '/api/v2/lobby/.*', function(req) {
  const pubkey = req.path.split('/')[4]
  if (this.db.lobbies[pubkey] == null) {
    return new FakeResponse(`Cannot find lobby "${pubkey}"`, { status: 404 })
  }
  return makeResponse(this.db.lobbies[pubkey])
})

addRoute('DELETE', '/api/v2/lobby/.*', function(req) {
  const pubkey = req.path.split('/')[4]
  delete this.db.lobbies[pubkey]
  return makeResponse()
})

// messages: ---------------------------------------------------------------

addRoute('POST', '/api/v2/messages', function(req) {
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
  return makeResponse(out)
})

// sync: -------------------------------------------------------------------

function storeRoute(req) {
  const elements = req.path.split('/')
  const syncKey = elements[4]
  // const hash = elements[5]

  const repo = this.repos[syncKey]
  if (repo == null) {
    return new FakeResponse('Cannot find repo ' + syncKey, { status: 404 })
  }

  switch (req.method) {
    case 'POST': {
      const changes = req.body.changes
      for (const change of Object.keys(changes)) {
        repo[change] = changes[change]
      }
      return new FakeResponse(
        JSON.stringify({
          changes: repo,
          hash: '1111111111111111111111111111111111111111'
        })
      )
    }

    case 'GET':
      return new FakeResponse(JSON.stringify({ changes: repo }))
  }
}

addRoute('GET', '/api/v2/store/.*', storeRoute)
addRoute('POST', '/api/v2/store/.*', storeRoute)
