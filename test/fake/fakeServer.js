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
  if (results) {
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

const authLevel = {
  none: 'none',
  recovery2Id: 'recovery2Id',
  full: 'full'
}

export function FakeServer () {
  this.db = {}
  this.repos = {}
}

FakeServer.prototype.populateRepos = function () {
  this.repos = packages.repos
}

FakeServer.prototype.populate = function () {
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

FakeServer.prototype.authCheck = function (body) {
  // Password login:
  if (this.db.userId && this.db.userId === body['userId'] &&
      this.db.passwordAuth && this.db.passwordAuth === body['passwordAuth']) {
    return authLevel.full
  }

  // PIN2 login:
  if (this.db.pin2Id && this.db.pin2Id === body['pin2Id'] &&
      this.db.pin2Auth && this.db.pin2Auth === body['pin2Auth']) {
    return authLevel.full
  }

  // Recovery2 login:
  if (this.db.recovery2Id && this.db.recovery2Id === body['recovery2Id']) {
    // Check answers:
    const recovery2Auth = body['recovery2Auth']
    if (recovery2Auth instanceof Array &&
        recovery2Auth.length === this.db.recovery2Auth.length) {
      for (let i = 0; i < recovery2Auth.length; ++i) {
        if (recovery2Auth[i] !== this.db.recovery2Auth[i]) {
          return authLevel.recovery2Id
        }
      }
      return authLevel.full
    }
    return authLevel.recovery2Id
  }

  return authLevel.none
}

FakeServer.prototype.request = function (uri, opts) {
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

// Account lifetime v1: ----------------------------------------------------

addRoute('POST', '/api/v1/account/available', function (req) {
  if (this.db.userId && this.db.userId === req.body['l1']) {
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

addRoute('POST', '/api/v1/account/activate', function (req) {
  return makeResponse()
})

// Login v1: ---------------------------------------------------------------

addRoute('POST', '/api/v1/account/carepackage/get', function (req) {
  if (!this.db.userId || this.db.userId !== req.body['l1']) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  return makeResponse({
    'care_package': JSON.stringify({
      'SNRP2': this.db.passwordKeySnrp
    })
  })
})

addRoute('POST', '/api/v1/account/loginpackage/get', function (req) {
  req.body['userId'] = req.body['l1']
  req.body['passwordAuth'] = req.body['lp1']
  if (!this.authCheck(req.body)) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  const results = {
    'login_package': JSON.stringify({
      'ELP1': this.db.passwordAuthBox,
      'EMK_LP2': this.db.passwordBox,
      'ESyncKey': this.db.syncKeyBox
    })
  }
  if (this.db.rootKeyBox) {
    results['rootKeyBox'] = this.db.rootKeyBox
  }
  return makeResponse(results)
})

// PIN login v1: -----------------------------------------------------------

addRoute('POST', '/api/v1/account/pinpackage/update', function (req) {
  this.db.pinKeyBox = JSON.parse(req.body['pin_package'])
  return makeResponse()
})

addRoute('POST', '/api/v1/account/pinpackage/get', function (req) {
  if (!this.db.pinKeyBox) {
    return makeErrorResponse(errorCodes.noAccount)
  }
  return makeResponse({
    'pin_package': JSON.stringify(this.db.pinKeyBox)
  })
})

// Repo server v1: ---------------------------------------------------------

addRoute('POST', '/api/v1/wallet/create', function (req) {
  this.repos[req.body['repo_wallet_key']] = {}
  return makeResponse()
})

addRoute('POST', '/api/v1/wallet/activate', function (req) {
  return makeResponse()
})

// login v2: ---------------------------------------------------------------

addRoute('POST', '/api/v2/login', function (req) {
  switch (this.authCheck(req.body)) {
    default:
      return makeErrorResponse(errorCodes.noAccount)

    case authLevel.recovery2Id:
      return makeResponse({
        'question2Box': this.db.question2Box
      })

    case authLevel.full:
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
        if (this.db[key]) {
          results[key] = this.db[key]
        }
      })
      return makeResponse(results)
  }
})

addRoute('POST', '/api/v2/login/password', function (req) {
  if (!this.authCheck(req.body)) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  const data = req.body['data']
  if (!data['passwordAuth'] || !data['passwordKeySnrp'] ||
      !data['passwordBox'] || !data['passwordAuthBox']) {
    return makeErrorResponse(errorCodes.error)
  }

  this.db.passwordAuth = data['passwordAuth']
  this.db.passwordKeySnrp = data['passwordKeySnrp']
  this.db.passwordBox = data['passwordBox']
  this.db.passwordAuthBox = data['passwordAuthBox']

  return makeResponse()
})

addRoute('POST', '/api/v2/login/pin2', function (req) {
  if (!this.authCheck(req.body)) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  const data = req.body['data']
  if (!data['pin2Id'] || !data['pin2Auth'] ||
      !data['pin2Box'] || !data['pin2KeyBox']) {
    return makeErrorResponse(errorCodes.error)
  }

  this.db.pin2Id = data['pin2Id']
  this.db.pin2Auth = data['pin2Auth']
  this.db.pin2Box = data['pin2Box']
  this.db.pin2KeyBox = data['pin2KeyBox']

  return makeResponse()
})

addRoute('POST', '/api/v2/login/recovery2', function (req) {
  if (!this.authCheck(req.body)) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  const data = req.body['data']
  if (!data['recovery2Id'] || !data['recovery2Auth'] ||
      !data['question2Box'] || !data['recovery2Box'] ||
      !data['recovery2KeyBox']) {
    return makeErrorResponse(errorCodes.error)
  }

  this.db.recovery2Id = data['recovery2Id']
  this.db.recovery2Auth = data['recovery2Auth']
  this.db.question2Box = data['question2Box']
  this.db.recovery2Box = data['recovery2Box']
  this.db.recovery2KeyBox = data['recovery2KeyBox']

  return makeResponse()
})

addRoute('POST', '/api/v2/login/repos', function (req) {
  if (!this.authCheck(req.body)) {
    return makeErrorResponse(errorCodes.noAccount)
  }

  const data = req.body['data']
  if (!data['type'] || !data['info']) {
    return makeErrorResponse(errorCodes.error)
  }

  if (this.db.repos) {
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
  if (!repo) {
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
 * Makes a stand-alone fetch function that is bound to `this`.
 */
FakeServer.prototype.bindFetch = function () {
  return (uri, opts) => {
    try {
      return Promise.resolve(this.request(uri, opts))
    } catch (e) {
      return Promise.reject(e)
    }
  }
}
