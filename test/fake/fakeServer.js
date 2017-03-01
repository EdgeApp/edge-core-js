import * as packages from './packages.js'
import url from 'url'

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
  return routes.filter(route => {
    return route.method === method && route.path.test(path)
  }).map(route => route.handler)
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
    'status_code': 0
  }
  if (results != null) {
    reply['results'] = results
  }
  return new FakeResponse(JSON.stringify(reply))
}

function makeErrorResponse (code, message = '', status = 500) {
  const body = {
    status_code: code,
    message: message || 'Server error'
  }
  return new FakeResponse(JSON.stringify(body), {status})
}

// Authentication middleware: ----------------------------------------------

/**
 * Verifies that the request contains valid v1 authenticaion.
 */
function authHandler1 (req) {
  // Password login:
  if (req.body.l1 != null && req.body.lp1 != null) {
    if (req.body.l1 !== this.db.userId) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.lp1 !== this.db.passwordAuth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    return null
  }
  return makeErrorResponse(errorCodes.error)
}

/**
 * Verifies that the request contains valid v2 authenticaion.
 */
function authHandler (req) {
  // Password login:
  if (req.body.userId != null && req.body.passwordAuth != null) {
    if (req.body.userId !== this.db.userId) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.passwordAuth !== this.db.passwordAuth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    return null
  }

  // PIN2 login:
  if (req.body.pin2Id != null && req.body.pin2Auth != null) {
    if (req.body.pin2Id !== this.db.pin2Id) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    if (req.body.pin2Auth !== this.db.pin2Auth) {
      return makeErrorResponse(errorCodes.invalidPassword)
    }
    return null
  }

  // Recovery2 login:
  if (req.body.recovery2Id != null && req.body.recovery2Auth != null) {
    if (req.body.recovery2Id !== this.db.recovery2Id) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    const serverAuth = this.db.recovery2Auth
    const clientAuth = req.body.recovery2Auth
    if (clientAuth.length !== serverAuth.length) {
      return makeErrorResponse(errorCodes.invalidAnswers)
    }
    for (let i = 0; i < clientAuth.length; ++i) {
      if (clientAuth[i] !== serverAuth[i]) {
        return makeErrorResponse(errorCodes.invalidAnswers)
      }
    }
    return null
  }
  return makeErrorResponse(errorCodes.error)
}

// Account lifetime v1: ----------------------------------------------------

addRoute('POST', '/api/v1/account/available', function (req) {
  if (req.body.l1 != null && req.body.l1 === this.db.userId) {
    return makeErrorResponse(errorCodes.accountExists)
  }
  return makeResponse()
})

addRoute('POST', '/api/v1/account/create', function (req) {
  this.db.userId = req.body['l1']
  this.db.passwordAuth = req.body['lp1']

  const carePackage = JSON.parse(req.body['care_package'])
  this.db.passwordKeySnrp = carePackage['SNRP2']

  const loginPackage = JSON.parse(req.body['login_package'])
  this.db.passwordAuthBox = loginPackage['ELP1']
  this.db.passwordBox = loginPackage['EMK_LP2']
  this.db.syncKeyBox = loginPackage['ESyncKey']
  this.repos[req.body['repo_account_key']] = {}

  return makeResponse()
})

addRoute('POST', '/api/v1/account/activate', authHandler1, function (req) {
  return makeResponse()
})

// Login v1: ---------------------------------------------------------------

addRoute('POST', '/api/v1/account/carepackage/get', function (req) {
  if (req.body.l1 == null || req.body.l1 !== this.db.userId) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  return makeResponse({
    'care_package': JSON.stringify({
      'SNRP2': this.db.passwordKeySnrp
    })
  })
})

addRoute('POST', '/api/v1/account/loginpackage/get', authHandler1, function (req) {
  const results = {
    'login_package': JSON.stringify({
      'ELP1': this.db.passwordAuthBox,
      'EMK_LP2': this.db.passwordBox,
      'ESyncKey': this.db.syncKeyBox
    })
  }
  if (this.db.rootKeyBox != null) {
    results['rootKeyBox'] = this.db.rootKeyBox
  }
  return makeResponse(results)
})

// PIN login v1: -----------------------------------------------------------

addRoute('POST', '/api/v1/account/pinpackage/update', authHandler1, function (req) {
  this.db.pinKeyBox = JSON.parse(req.body['pin_package'])
  return makeResponse()
})

addRoute('POST', '/api/v1/account/pinpackage/get', function (req) {
  if (this.db.pinKeyBox == null) {
    return makeErrorResponse(errorCodes.noAccount)
  }
  return makeResponse({
    'pin_package': JSON.stringify(this.db.pinKeyBox)
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

addRoute('POST', '/api/v2/login', function (req) {
  if (req.body.recovery2Id != null && req.body.recovery2Auth == null) {
    if (req.body.recovery2Id !== this.db.recovery2Id) {
      return makeErrorResponse(errorCodes.noAccount)
    }
    return makeResponse({
      'question2Box': this.db.question2Box
    })
  }
  return null
}, authHandler, function (req) {
  const results = {}
  const keys = [
    'passwordAuthBox',
    'passwordBox',
    'passwordKeySnrp',
    'pin2Box',
    'pin2KeyBox',
    'recovery2Box',
    'recovery2KeyBox',
    'rootKeyBox',
    'syncKeyBox',
    'repos'
  ]
  keys.forEach(key => {
    if (key in this.db) {
      results[key] = this.db[key]
    }
  })
  return makeResponse(results)
})

addRoute('POST', '/api/v2/login/create', function (req) {
  const data = req.body['data']

  // Set up repos:
  if (data.newSyncKeys != null) {
    data.newSyncKeys.forEach(syncKey => {
      this.repos[syncKey] = {}
    })
  }

  // Set up login object:
  const keys = [
    'userId',
    'passwordAuth',
    'passwordAuthBox',
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
    'rootKeyBox',
    'syncKeyBox',
    'repos'
  ]
  keys.forEach(key => {
    if (key in data) {
      this.db[key] = data[key]
    }
  })

  return makeResponse()
})

addRoute('POST', '/api/v2/login/password', authHandler, function (req) {
  const data = req.body['data']
  if (data.passwordAuth == null || data.passwordKeySnrp == null ||
      data.passwordBox == null || data.passwordAuthBox == null) {
    return makeErrorResponse(errorCodes.error)
  }

  this.db.passwordAuth = data['passwordAuth']
  this.db.passwordKeySnrp = data['passwordKeySnrp']
  this.db.passwordBox = data['passwordBox']
  this.db.passwordAuthBox = data['passwordAuthBox']

  return makeResponse()
})

addRoute('POST', '/api/v2/login/pin2', authHandler, function (req) {
  const data = req.body['data']
  if (data.pin2Id == null || data.pin2Auth == null ||
      data.pin2Box == null || data.pin2KeyBox == null) {
    return makeErrorResponse(errorCodes.error)
  }

  this.db.pin2Id = data['pin2Id']
  this.db.pin2Auth = data['pin2Auth']
  this.db.pin2Box = data['pin2Box']
  this.db.pin2KeyBox = data['pin2KeyBox']

  return makeResponse()
})

addRoute('POST', '/api/v2/login/recovery2', authHandler, function (req) {
  const data = req.body['data']
  if (data.recovery2Id == null || data.recovery2Auth == null ||
      data.question2Box == null || data.recovery2Box == null ||
      data.recovery2KeyBox == null) {
    return makeErrorResponse(errorCodes.error)
  }

  this.db.recovery2Id = data['recovery2Id']
  this.db.recovery2Auth = data['recovery2Auth']
  this.db.question2Box = data['question2Box']
  this.db.recovery2Box = data['recovery2Box']
  this.db.recovery2KeyBox = data['recovery2KeyBox']

  return makeResponse()
})

addRoute('POST', '/api/v2/login/repos', authHandler, function (req) {
  const data = req.body['data']
  if (data.type == null || data.info == null) {
    return makeErrorResponse(errorCodes.error)
  }

  if (this.db.repos != null) {
    this.db.repos.push(data)
  } else {
    this.db.repos = [data]
  }

  return makeResponse()
})

// lobby: ------------------------------------------------------------------

addRoute('POST', '/api/v2/lobby', function (req) {
  this.db.lobby = req.body['data']
  return makeResponse({
    'id': 'IMEDGELOGIN'
  })
})

addRoute('GET', '/api/v2/lobby/IMEDGELOGIN', function (req) {
  return makeResponse(this.db.lobby)
})

addRoute('PUT', '/api/v2/lobby/IMEDGELOGIN', function (req) {
  this.db.lobby = req.body['data']
  return makeResponse()
})

// sync: -------------------------------------------------------------------

function storeRoute (req) {
  const elements = req.path.split('/')
  const syncKey = elements[4]
  // const hash = elements[5]

  const repo = this.repos[syncKey]
  if (repo == null) {
    return new FakeResponse('Cannot find repo ' + syncKey, {status: 404})
  }

  switch (req.method) {
    case 'POST':
      const changes = req.body['changes']
      Object.keys(changes).forEach(change => {
        repo[change] = changes[change]
      })
      return new FakeResponse(JSON.stringify({
        'changes': changes,
        'hash': '1111111111111111111111111111111111111111'
      }))

    case 'GET':
      return new FakeResponse(JSON.stringify({'changes': repo}))
  }
}

addRoute('GET', '/api/v2/store/.*', storeRoute)
addRoute('POST', '/api/v2/store/.*', storeRoute)

/**
 * Emulates the Airbitz login server.
 */
export class FakeServer {
  constructor () {
    this.db = {}
    this.repos = {}
    this.fetch = (uri, opts) => {
      try {
        return Promise.resolve(this.request(uri, opts))
      } catch (e) {
        return Promise.reject(e)
      }
    }
  }

  populateRepos () {
    this.repos = packages.repos
  }

  populate () {
    this.populateRepos()
    this.db.userId = packages.users['js test 0']
    this.db.passwordAuth = packages.passwordAuth
    this.db.passwordAuthBox = packages.passwordAuthBox
    this.db.passwordBox = packages.passwordBox
    this.db.passwordKeySnrp = packages.passwordKeySnrp
    this.db.pin2Id = packages.pin2Id
    this.db.pin2Auth = packages.pin2Auth
    this.db.pin2Box = packages.pin2Box
    this.db.pin2KeyBox = packages.pin2KeyBox
    this.db.recovery2Id = packages.recovery2Id
    this.db.recovery2Auth = packages.recovery2Auth
    this.db.recovery2Box = packages.recovery2Box
    this.db.recovery2KeyBox = packages.recovery2KeyBox
    this.db.question2Box = packages.question2Box
    this.db.syncKeyBox = packages.syncKeyBox
    this.db.rootKeyBox = packages.rootKeyBox
    this.db.pinKeyBox = packages.pinKeyBox
  }

  request (uri, opts) {
    const req = {
      method: opts.method || 'GET',
      body: opts.body ? JSON.parse(opts.body) : null,
      path: url.parse(uri).pathname
    }

    const handlers = findRoute(req.method, req.path)
    for (const handler of handlers) {
      const out = handler.call(this, req)
      if (out != null) {
        return out
      }
    }
    return makeErrorResponse(errorCodes.error, `Unknown API endpoint ${req.path}`, 404)
  }
}
