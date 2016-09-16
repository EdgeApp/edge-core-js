var FakeStorage = require('./test/fake/fakeStorage.js').FakeStorage
var realServer = require('./test/fake/realServer.js')
var abc = require('./src/abc.js')

function accountCreate (opt) {
  if (!opt.options.password || !opt.options.username) {
    return console.log('Please provide a username and password')
  }

  var fakeStorage = new FakeStorage()
  var ctx = new abc.Context(realServer.authRequest, fakeStorage, opt.options['account-type'])

  ctx.accountCreate(opt.options.username, opt.options.password, function (err, account) {
    if (err) return console.log(err)
    console.log('done')
  })
}

function passwordLogin (opt) {
  var fakeStorage = new FakeStorage()
  var ctx = new abc.Context(realServer.authRequest, fakeStorage, opt.options['account-type'])

  ctx.passwordLogin(opt.options.username, opt.options.password, function (err, account) {
    if (err) return console.log(err)
    console.log('done')
  })
}

function passwordSetup (opt) {
  if (opt.argv.length < 2) {
    return console.log('new password missing')
  }
  var newPassword = opt.argv[1]

  var fakeStorage = new FakeStorage()
  var ctx = new abc.Context(realServer.authRequest, fakeStorage, opt.options['account-type'])

  ctx.passwordLogin(opt.options.username, opt.options.password, function (err, account) {
    if (err) return console.log(err)
    account.passwordSetup(newPassword, function (err) {
      if (err) return console.log(err)
      console.log('done')
    })
  })
}

module.exports = {
  'account-create': accountCreate,
  'password-login': passwordLogin,
  'password-setup': passwordSetup
}
