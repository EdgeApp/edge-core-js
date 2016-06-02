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
  this.db.carePackage = packages.carePackage
  this.db.loginPackage = packages.loginPackage
  this.db.rootKeyBox = packages.rootKeyBox
  this.db.pinKeyBox = packages.pinKeyBox
}

FakeServer.prototype.request = function (method, uri, body, callback) {
  var results = {}

  if (uri.search('account/available') > 0) {
    if (body['l1'] === packages.users['js test 0']) {
      return callback(null, 500, '{"status_code":3}')
    }
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('carepackage/get') > 0) {
    if (!this.db.carePackage) {
      return callback(null, 500, '{"status_code":3}')
    }

    results['care_package'] = JSON.stringify(this.db.carePackage)
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('loginpackage/get') > 0) {
    if (!this.db.loginPackage) {
      return callback(null, 500, '{"status_code":3}')
    }

    results['login_package'] = JSON.stringify(this.db.loginPackage)
    if (this.db.rootKeyBox) {
      results['rootKeyBox'] = this.db.rootKeyBox
    }
    return callback(null, 200, makeReply(results))
  }

  if (uri.search('pinpackage/update') > 0) {
    this.db.pinKeyBox = JSON.parse(body['pin_package'])
    return callback(null, 200, makeReply({}))
  }

  if (uri.search('pinpackage/get') > 0) {
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
