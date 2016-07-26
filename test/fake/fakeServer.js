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
  this.db.passwordAuth = packages.passwordAuth
  this.db.passwordAuthBox = packages.passwordAuthBox
  this.db.passwordBox = packages.passwordBox
  this.db.passwordKeySnrp = packages.passwordKeySnrp
  this.db.syncKeyBox = packages.syncKeyBox
  this.db.rootKeyBox = packages.rootKeyBox
  this.db.pinKeyBox = packages.pinKeyBox
}

FakeServer.prototype.request = function (method, uri, body, callback) {
  var results = {}

  if (uri.search('/v1/account/available') > 0) {
    if (body['l1'] === packages.users['js test 0']) {
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

  if (uri.search('/v1/account/carepackage/get') > 0) {
    if (body['l1'] !== packages.users['js test 0']) {
      return callback(null, 500, '{"status_code":3}')
    }

    results['care_package'] = JSON.stringify({
      'SNRP2': this.db.passwordKeySnrp
    })
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('/v1/account/loginpackage/get') > 0) {
    if (body['lp1'] !== packages.passwordAuth) {
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
