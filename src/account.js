var crypto = require('./crypto.js')
var UserStorage = require('./userStorage.js').UserStorage
var userMap = require('./userMap.js')
var loginPin = require('./login/pin.js')

function Account (ctx, username, dataKey) {
  this.ctx = ctx
  this.username = username
  this.userStorage = new UserStorage(ctx.localStorage, username)
  this.userId = userMap.getUserId(ctx.localStorage, username)

  // Grab all the boxes:
  var authKeyBox = this.userStorage.getJson('authKeyBox')
  var rootKeyBox = this.userStorage.getJson('rootKeyBox')
  var syncKeyBox = this.userStorage.getJson('syncKeyBox')
  if (!authKeyBox) throw Error('Missing authKeyBox')
  if (!rootKeyBox) throw Error('Missing rootKeyBox')
  if (!syncKeyBox) throw Error('Missing syncKeyBox')

  // Set up the keys:
  this.dataKey = dataKey
  this.authKey = crypto.decrypt(authKeyBox, dataKey)
  this.syncKey = crypto.decrypt(syncKeyBox, dataKey)
  this.rootKey = crypto.decrypt(rootKeyBox, dataKey)
}

Account.prototype.logout = function () {
  this.dataKey = null
  this.authKey = null
  this.syncKey = null
  this.rootKey = null
}

Account.prototype.pinSetup = function (pin, callback) {
  return loginPin.setup(this.ctx, this, pin, callback)
}

exports.Account = Account
exports.UserStorage = 'fun'
