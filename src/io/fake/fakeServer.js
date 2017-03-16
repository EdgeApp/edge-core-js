import { filterObject } from '../../util/util.js'

const routes = []

/**
 * Wires one or more handlers into the routing table.
 */
function addRoute (method, path, ...handlers) {
  handlers.forEach(handler => {
    routes.push({
      method,
      path: new RegExp(`^${path}$`),
      handler
    })
  })
}

/**
 * Finds all matching handlers in the routing table.
 */
function findRoute (method, path) {
  return routes
    .filter(route => {
      return route.method === method && route.path.test(path)
    })
    .map(route => route.handler)
}

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

class FakeResponse {
  constructor (body = '', opts = {}) {
    this.body = body
    this.status = opts.status || 200
    this.statusText = opts.statusText || 'OK'
    this.ok = this.status >= 200 && this.status < 300
  }

  json () {
    try {
      return Promise.resolve(JSON.parse(this.body))
    } catch (e) {
      return Promise.reject(e)
    }
  }

  text () {
    return Promise.resolve(this.body)
  }
}

function makeResponse (results) {
  const reply = {
    status_code: 0
  }
  if (results != null) {
    reply.results = results
  }
  return new FakeResponse(JSON.stringify(reply))
}

function makeErrorResponse (code, message = '', status = 500) {
  const body = {
    status_code: code,
    message: message || 'Server error'
  }
  return new FakeResponse(JSON.stringify(body), { status })
}

// Authentication middleware: ----------------------------------------------

/**
 * Verifies that the request contains valid v1 authenticaion.
 */
function authHandler1 (req) {
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
function authHandler (req) {
  // Token login:
  if (req.body.loginId != null && req.body.loginAuth != null) {
    const login = this.findLoginId(req.body.loginId)
    if (login == null) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.loginAuth !== login.loginAuth) {
      return makeErrorResponse(errorCodes.invalidPassword)
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
    req.login = login
    return
  }
  return makeErrorResponse(errorCodes.error, 'Missing credentials')
}

// Account lifetime v1: ----------------------------------------------------

addRoute('POST', '/api/v1/account/available', function (req) {
  if (this.findLoginId(req.body.l1)) {
    return makeErrorResponse(errorCodes.accountExists)
  }
  return makeResponse()
})

addRoute('POST', '/api/v1/account/create', function (req) {
  if (this.findLoginId(req.body.l1)) {
    return makeErrorResponse(errorCodes.accountExists)
  }

  const carePackage = JSON.parse(req.body['care_package'])
  const loginPackage = JSON.parse(req.body['login_package'])
  this.db.logins.push({
    appId: '',
    loginId: req.body['l1'],
    passwordAuth: req.body['lp1'],
    passwordKeySnrp: carePackage['SNRP2'],
    passwordAuthBox: loginPackage['ELP1'],
    passwordBox: loginPackage['EMK_LP2'],
    syncKeyBox: loginPackage['ESyncKey']
  })
  this.repos[req.body['repo_account_key']] = {}

  return makeResponse()
})

addRoute('POST', '/api/v1/account/activate', authHandler1, function (req) {
  return makeResponse()
})

// Login v1: ---------------------------------------------------------------

addRoute('POST', '/api/v1/account/carepackage/get', function (req) {
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

addRoute(
  'POST',
  '/api/v1/account/loginpackage/get',
  authHandler1,
  function (req) {
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
  }
)

// PIN login v1: -----------------------------------------------------------

addRoute(
  'POST',
  '/api/v1/account/pinpackage/update',
  authHandler1,
  function (req) {
    this.db.pinKeyBox = JSON.parse(req.body['pin_package'])
    return makeResponse()
  }
)

addRoute('POST', '/api/v1/account/pinpackage/get', function (req) {
  if (this.db.pinKeyBox == null) {
    return makeErrorResponse(errorCodes.noAccount)
  }
  return makeResponse({
    pin_package: JSON.stringify(this.db.pinKeyBox)
  })
})

// Repo server v1: ---------------------------------------------------------

addRoute('POST', '/api/v1/wallet/create', authHandler1, function (req) {
  this.repos[req.body['repo_wallet_key']] = {}
  return makeResponse()
})

addRoute('POST', '/api/v1/wallet/activate', authHandler1, function (req) {
  return makeResponse()
})

// login v2: ---------------------------------------------------------------

addRoute(
  'POST',
  '/api/v2/login',
  function (req) {
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
  function (req) {
    return makeResponse(this.makeReply(req.login))
  }
)

addRoute('POST', '/api/v2/login/create', function (req) {
  const data = req.body.data

  // Set up repos:
  if (data.newSyncKeys != null) {
    data.newSyncKeys.forEach(syncKey => {
      this.repos[syncKey] = {}
    })
  }

  // Set up login object:
  const row = filterObject(data, [
    'appId',
    'loginId',
    'loginAuth',
    'loginAuthBox',
    'parentBox',
    'passwordAuth',
    'passwordAuthBox',
    'passwordAuthSnrp',
    'passwordBox',
    'passwordKeySnrp',
    'pin2Auth',
    'pin2Box',
    'pin2Id',
    'pin2KeyBox',
    'question2Box',
    'recovery2Auth',
    'recovery2Box',
    'recovery2Id',
    'recovery2KeyBox',
    'mnemonicBox', // Used for testing, not part of the real server!
    'rootKeyBox', // Same
    'syncKeyBox', // Same
    'repos'
  ])
  if (!authHandler.call(this, req)) {
    row.parent = req.login.loginId
  }
  this.db.logins.push(row)

  return makeResponse()
})

addRoute('POST', '/api/v2/login/keys', authHandler, function (req) {
  const data = req.body['data']
  if (data.keyBoxes == null) {
    return makeErrorResponse(errorCodes.error)
  }

  // Set up repos:
  if (data.newSyncKeys != null) {
    data.newSyncKeys.forEach(syncKey => {
      this.repos[syncKey] = {}
    })
  }

  const keyBoxes = req.login.keyBoxes != null ? req.login.keyBoxes : []
  req.login.keyBoxes = [...keyBoxes, ...data.keyBoxes]

  return makeResponse()
})

addRoute('POST', '/api/v2/login/password', authHandler, function (req) {
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

addRoute('POST', '/api/v2/login/pin2', authHandler, function (req) {
  const data = req.body.data
  if (
    data.pin2Auth == null ||
    data.pin2Box == null ||
    data.pin2Id == null ||
    data.pin2KeyBox == null
  ) {
    return makeErrorResponse(errorCodes.error)
  }

  req.login.pin2Auth = data.pin2Auth
  req.login.pin2Box = data.pin2Box
  req.login.pin2Id = data.pin2Id
  req.login.pin2KeyBox = data.pin2KeyBox

  return makeResponse()
})

addRoute('POST', '/api/v2/login/recovery2', authHandler, function (req) {
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

addRoute('POST', '/api/v2/lobby', function (req) {
  this.db.lobby = req.body.data
  return makeResponse({
    id: 'IMEDGELOGIN'
  })
})

addRoute('GET', '/api/v2/lobby/IMEDGELOGIN', function (req) {
  return makeResponse(this.db.lobby)
})

addRoute('PUT', '/api/v2/lobby/IMEDGELOGIN', function (req) {
  this.db.lobby = req.body.data
  return makeResponse()
})

// sync: -------------------------------------------------------------------

function storeRoute (req) {
  const elements = req.path.split('/')
  const syncKey = elements[4]
  // const hash = elements[5]

  const repo = this.repos[syncKey]
  if (repo == null) {
    return new FakeResponse('Cannot find repo ' + syncKey, { status: 404 })
  }

  switch (req.method) {
    case 'POST':
      const changes = req.body.changes
      Object.keys(changes).forEach(change => {
        repo[change] = changes[change]
      })
      return new FakeResponse(
        JSON.stringify({
          changes: changes,
          hash: '1111111111111111111111111111111111111111'
        })
      )

    case 'GET':
      return new FakeResponse(JSON.stringify({ changes: repo }))
  }
}

addRoute('GET', '/api/v2/store/.*', storeRoute)
addRoute('POST', '/api/v2/store/.*', storeRoute)

/**
 * Emulates the Airbitz login server.
 */
export class FakeServer {
  constructor () {
    this.db = { logins: [] }
    this.repos = {}
    this.fetch = (uri, opts = {}) => {
      try {
        return Promise.resolve(this.request(uri, opts))
      } catch (e) {
        return Promise.reject(e)
      }
    }
  }

  findLoginId (loginId) {
    if (loginId == null) return
    return this.db.logins.find(login => login.loginId === loginId)
  }

  findPin2Id (pin2Id) {
    return this.db.logins.find(login => login.pin2Id === pin2Id)
  }

  findRecovery2Id (recovery2Id) {
    return this.db.logins.find(login => login.recovery2Id === recovery2Id)
  }

  makeReply (login) {
    const reply = filterObject(login, [
      'appId',
      'loginId',
      'loginAuthBox',
      'parentBox',
      'passwordAuthBox',
      'passwordAuthSnrp',
      'passwordBox',
      'passwordKeySnrp',
      'pin2Box',
      'pin2KeyBox',
      'question2Box',
      'recovery2Box',
      'recovery2KeyBox',
      'mnemonicBox',
      'rootKeyBox',
      'syncKeyBox',
      'keyBoxes'
    ])
    reply.children = this.db.logins
      .filter(child => child.parent === login.loginId)
      .map(child => this.makeReply(child))
    return reply
  }

  request (uri, opts) {
    const req = {
      method: opts.method || 'GET',
      body: opts.body ? JSON.parse(opts.body) : null,
      path: uri.replace(new RegExp('https?://[^/]*'), '')
    }

    const handlers = findRoute(req.method, req.path)
    for (const handler of handlers) {
      const out = handler.call(this, req)
      if (out != null) {
        return out
      }
    }
    return makeErrorResponse(
      errorCodes.error,
      `Unknown API endpoint ${req.path}`,
      404
    )
  }
}
