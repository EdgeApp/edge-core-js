import {Account} from './account.js'
import * as crypto from './crypto.js'
import * as loginCreate from './login/create.js'
import * as loginEdge from './login/edge.js'
import * as loginPassword from './login/password.js'
import * as loginPin2 from './login/pin2.js'
import * as loginRecovery2 from './login/recovery2.js'
import * as userMap from './userMap.js'
import {UserStorage} from './userStorage.js'

var serverRoot = 'https://auth.airbitz.co/api'
// var serverRoot = 'https://test-auth.airbitz.co/api'

var DomWindow
if (typeof (window) === 'undefined') {
  DomWindow = {
    localStorage: null,
    XMLHttpRequest: function () {
      console.log('XMLHttpRequest: Error browser routine used in non-browser environment')
    },
    performance: {
      now: function () {
        console.log('performance: Error browser routine used in non-browser environment')
      }
    }
  }
} else {
  DomWindow = window
}

/**
 * @param authRequest function (method, uri, body, callback (err, status, body))
 * @param localStorage an object compatible with the Web Storage API.
 */
export function Context (opts) {
  opts = opts || {}
  this.accountType = opts.accountType || 'account:repo:co.airbitz.wallet'
  this.localStorage = opts.localStorage || DomWindow.localStorage

  function webFetch (method, uri, body, callback) {
    var xhr = new DomWindow.XMLHttpRequest()
    xhr.addEventListener('load', function () {
      callback(null, this.status, this.responseText)
    })
    xhr.addEventListener('error', function () {
      callback(Error('Cannot reach auth server'))
    })
    xhr.open(method, uri)
    xhr.setRequestHeader('Authorization', 'Token ' + opts.apiKey)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.send(JSON.stringify(body))
    console.log('Visit ' + uri)
  }
  this.authFetch = opts.authRequest || webFetch

  /**
   * Wraps the raw authRequest function in something more friendly.
   * @param body JSON object
   * @param callback function (err, reply JSON object)
   */
  this.authRequest = function (method, uri, body, callback) {
    this.authFetch(method, serverRoot + uri, body, function (err, status, body) {
      if (err) return callback(err)
      try {
        var reply = JSON.parse(body)
      } catch (e) {
        return callback(Error('Non-JSON reply, HTTP status ' + status))
      }

      // Look at the Airbitz status code:
      switch (reply['status_code']) {
        case 0:
          return callback(null, reply.results)
        default:
          return callback(Error(body))
      }
    })
  }
}

Context.prototype.usernameList = function () {
  var map = userMap.load(this.localStorage)
  var out = []
  for (var username in map) {
    if (map.hasOwnProperty(username)) {
      out.push(username)
    }
  }
  return out
}
Context.prototype.listUsernames = Context.prototype.usernameList

Context.prototype.fixUsername = userMap.normalize

Context.prototype.usernameAvailable = function (username, callback) {
  return loginCreate.usernameAvailable(this, username, callback)
}

/**
 * Creates a login, then creates and attaches an account to it.
 */
Context.prototype.createAccount = function (username, password, pin, callback) {
  var ctx = this
  return loginCreate.create(ctx, username, password, {}, function (err, login) {
    if (err) return callback(err)
    try {
      login.accountFind(ctx.accountType)
    } catch (e) {
      // If the login doesn't have the correct account type, add it first:
      return login.accountCreate(ctx, ctx.accountType, function (err) {
        if (err) return callback(err)
        loginPin2.setup(ctx, login, pin, function (err) {
          if (err) return callback(err)
          var account = new Account(ctx, login)
          account.newAccount = true
          account.sync(function (err, dirty) {
            if (err) return callback(err)
            callback(null, account)
          })
        })
      })
    }

    // Otherwise, we have the correct account type, and can simply return:
    loginPin2.setup(ctx, login, pin, function (err) {
      if (err) return callback(err)
      var account = new Account(ctx, login)
      account.newAccount = true
      account.sync(function (err, dirty) {
        if (err) return callback(err)
        callback(null, account)
      })
    })
  })
}

Context.prototype.loginWithPassword = function (username, password, otp, opts, callback) {
  var ctx = this
  return loginPassword.login(ctx, username, password, function (err, login) {
    if (err) return callback(err)
    var account = new Account(ctx, login)
    account.passwordLogin = true
    account.sync(function (err, dirty) {
      if (err) return callback(err)
      callback(null, account)
    })
  })
}

Context.prototype.pinExists = function (username) {
  return loginPin2.getKey(this, username) != null
}
Context.prototype.pinLoginEnabled = function (username) {
  return loginPin2.getKey(this, username) != null
}

Context.prototype.loginWithPIN = function (username, pin, callback) {
  var ctx = this
  var pin2Key = loginPin2.getKey(this, username)
  return loginPin2.login(ctx, pin2Key, username, pin, function (err, login) {
    if (err) return callback(err)
    var account = new Account(ctx, login)
    account.pinLogin = true
    account.sync(function (err, dirty) {
      if (err) return callback(err)
      callback(null, account)
    })
  })
}

Context.prototype.getRecovery2Key = function (username, callback) {
  var userStorage = new UserStorage(this.localStorage, username)
  var recovery2Key = userStorage.getItem('recovery2Key')
  if (recovery2Key) {
    callback(null, recovery2Key)
  } else {
    callback(new Error('No recovery key stored locally.'))
  }
}

Context.prototype.loginWithRecovery2 = function (recovery2Key, username, answers, otp, options, callback) {
  var ctx = this
  return loginRecovery2.login(ctx, recovery2Key, username, answers, function (err, login) {
    if (err) return callback(err)
    var account = new Account(ctx, login)
    account.recoveryLogin = true
    account.sync(function (err, dirty) {
      if (err) return callback(err)
      callback(null, account)
    })
  })
}

Context.prototype.fetchRecovery2Questions = function (recovery2Key, username, callback) {
  return loginRecovery2.questions(this, recovery2Key, username, callback)
}

Context.prototype.runScryptTimingWithParameters = function (n, r, p) {
  var snrp = crypto.makeSnrp()
  // var snrp = {
  //   'salt_hex': crypto.random(32).toString('hex'),
  //   'n': 16384,
  //   'r': 1,
  //   'p': 1
  // }
  snrp.n = Math.pow(2, n)
  snrp.r = r
  snrp.p = p

  var hashTime = crypto.timeSnrp(snrp)

  return {
    time: hashTime
  }
}

Context.prototype.checkPasswordRules = function (password) {
  var tooShort = password.length < 10
  var noNumber = password.match(/\d/) == null
  var noUpperCase = password.match(/[A-Z]/) == null
  var noLowerCase = password.match(/[a-z]/) == null
  var extraLong = password.length >= 16

  return {
    'tooShort': tooShort,
    'noNumber': noNumber,
    'noUpperCase': noUpperCase,
    'noLowerCase': noLowerCase,
    'passed': extraLong || !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}

Context.prototype.requestEdgeLogin = function (opts, callback) {
  var ctx = this
  var onLogin = opts.onLogin
  opts.onLogin = function (err, login) {
    if (err) return onLogin(err)
    var account = new Account(ctx, login)
    account.edgeLogin = true
    account.sync(function (err, dirty) {
      if (err) return onLogin(err)
      onLogin(null, account)
    })
  }
  opts.type = opts.type || ctx.accountType
  loginEdge.create(this, opts, callback)
}

Context.prototype.listRecoveryQuestionChoices = function (callback) {
  loginRecovery2.listRecoveryQuestionChoices(this, function (error, questions) {
    callback(error, questions)
  })
}
