var packages = require('./packages.js')

function makeReply (results) {
  var reply = {
    'status_code': 0,
    'results': results
  }
  return JSON.stringify(reply)
}

function FakeServer () {
  this.db = {}
}

FakeServer.prototype.populate = function () {
  this.db.userId = packages.users['js test 0']
  this.db.passwordAuth = packages.passwordAuth
  this.db.passwordAuthBox = packages.passwordAuthBox
  this.db.passwordBox = packages.passwordBox
  this.db.passwordKeySnrp = packages.passwordKeySnrp
  this.db.syncKeyBox = packages.syncKeyBox
  this.db.rootKeyBox = packages.rootKeyBox
  this.db.pinKeyBox = packages.pinKeyBox
}

FakeServer.prototype.authCheck = function (body) {
  if (this.db.userId && this.db.userId === body['userId'] &&
      this.db.passwordAuth && this.db.passwordAuth === body['passwordAuth']) {
    return true
  }

  return false
}

FakeServer.prototype.request = function (method, uri, body, callback) {
  var results = {}

  // Account lifetime v1: ----------------------------------------------------

  if (uri.search('/v1/account/available') > 0) {
    if (this.db.userId && this.db.userId === body['l1']) {
      return callback(null, 500, '{"status_code":3}')
    }
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('/v1/account/create') > 0) {
    var carePackage = JSON.parse(body['care_package'])
    this.db.passwordKeySnrp = carePackage['SNRP2']

    var loginPackage = JSON.parse(body['login_package'])
    this.db.passwordAuthBox = loginPackage['ELP1']
    this.db.passwordBox = loginPackage['EMK_LP2']
    this.db.syncKeyBox = loginPackage['ESyncKey']

    return callback(null, 200, makeReply(results))
  }

  if (uri.search('/v1/account/upgrade') > 0) {
    this.db.rootKeyBox = body['rootKeyBox']
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('/v1/account/activate') > 0) {
    return callback(null, 200, makeReply(results))
  }

  // Login v1: ---------------------------------------------------------------

  if (uri.search('/v1/account/carepackage/get') > 0) {
    if (!this.db.userId || this.db.userId !== body['l1']) {
      return callback(null, 500, '{"status_code":3}')
    }

    results['care_package'] = JSON.stringify({
      'SNRP2': this.db.passwordKeySnrp
    })
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('/v1/account/loginpackage/get') > 0) {
    body['userId'] = body['l1']
    body['passwordAuth'] = body['lp1']
    if (!this.authCheck(body)) {
      return callback(null, 500, '{"status_code":3}')
    }

    results['login_package'] = JSON.stringify({
      'ELP1': this.db.passwordAuthBox,
      'EMK_LP2': this.db.passwordBox,
      'ESyncKey': this.db.syncKeyBox
    })
    if (this.db.rootKeyBox) {
      results['rootKeyBox'] = this.db.rootKeyBox
    }
    return callback(null, 200, makeReply(results))
  }

  // PIN login v1: -----------------------------------------------------------

  if (uri.search('/v1/account/pinpackage/update') > 0) {
    this.db.pinKeyBox = JSON.parse(body['pin_package'])
    return callback(null, 200, makeReply({}))
  }

  if (uri.search('/v1/account/pinpackage/get') > 0) {
    if (!this.db.pinKeyBox) {
      return callback(null, 500, '{"status_code":3}')
    }

    results['pin_package'] = JSON.stringify(this.db.pinKeyBox)
    return callback(null, 200, makeReply(results))
  }

  // login v2: ---------------------------------------------------------------

  if (uri.search('/v2/login') > 0) {
    if (!this.authCheck(body)) {
      return callback(null, 500, '{"status_code":3}')
    }

    if (this.db.passwordAuthBox) {
      results['passwordAuthBox'] = this.db.passwordAuthBox
    }
    if (this.db.passwordBox) {
      results['passwordBox'] = this.db.passwordBox
    }
    if (this.db.passwordKeySnrp) {
      results['passwordKeySnrp'] = this.db.passwordKeySnrp
    }
    if (this.db.rootKeyBox) {
      results['rootKeyBox'] = this.db.rootKeyBox
    }
    if (this.db.syncKeyBox) {
      results['syncKeyBox'] = this.db.syncKeyBox
    }
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('/v2/login/password') > 0) {
    if (!this.authCheck(body)) {
      return callback(null, 500, '{"status_code":3}')
    }

    switch (method) {
      case 'PUT':
        var data = body['password']
        if (!data['passwordAuth'] || !data['passwordKeySnrp'] ||
            !data['passwordBox'] || !data['passwordAuthBox']) {
          return callback(null, 500, '{"status_code":3}')
        }

        this.db.passwordAuth = data['passwordAuth']
        this.db.passwordKeySnrp = data['passwordKeySnrp']
        this.db.passwordBox = data['passwordBox']
        this.db.passwordAuthBox = data['passwordAuthBox']

        return callback(null, 200, makeReply(results))
    }
  }

  callback(null, 400, '')
}

/**
 * Makes a stand-alone request function that is bound to `this`.
 */
FakeServer.prototype.bindRequest = function () {
  var server = this
  return function () {
    FakeServer.prototype.request.apply(server, arguments)
  }
}

exports.FakeServer = FakeServer
