import {Account} from './account.js'
import * as crypto from './crypto.js'
import * as loginCreate from './login/create.js'
import * as loginEdge from './login/edge.js'
import * as loginPassword from './login/password.js'
import * as loginPin2 from './login/pin2.js'
import * as loginRecovery2 from './login/recovery2.js'
import {nodeify} from './util/nodeify.js'
import * as userMap from './userMap.js'
import {UserStorage} from './userStorage.js'

const serverRoot = 'https://auth.airbitz.co/api'
// const serverRoot = 'https://test-auth.airbitz.co/api'

let DomWindow = null
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
 * @param opts An object containing optional arguments.
 */
export function Context (opts) {
  opts = opts || {}
  this.accountType = opts.accountType || 'account:repo:co.airbitz.wallet'
  this.localStorage = opts.localStorage || DomWindow.localStorage
  this.fetch = opts.fetch || DomWindow.fetch

  /**
   * Wraps the raw authRequest function in something more friendly.
   * @param body JSON object to send
   * @return a promise of the server's JSON reply
   */
  this.authRequest = function (method, uri, body) {
    const headers = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + opts.apiKey
      }
    }
    if (method !== 'GET') {
      headers.body = JSON.stringify(body)
    }

    return this.fetch(serverRoot + uri, headers).then(response => {
      return response.json().then(json => {
        if (json['status_code'] !== 0) {
          throw new Error('Server error ' + JSON.stringify(json))
        }
        return json['results']
      }, jsonError => {
        throw new Error('Non-JSON reply, HTTP status ' + response.status)
      })
    }, networkError => {
      throw new Error('NetworkError: Could not connect to auth server')
    })
  }
}

Context.prototype.usernameList = function () {
  const map = userMap.load(this.localStorage)
  const out = []
  for (const username in map) {
    if (map.hasOwnProperty(username)) {
      out.push(username)
    }
  }
  return out
}
Context.prototype.listUsernames = Context.prototype.usernameList

Context.prototype.fixUsername = userMap.normalize

Context.prototype.removeUsername = function (username) {
  username = userMap.normalize(username)
  userMap.remove(this.localStorage, username)
  const store = new UserStorage(this.localStorage, username)
  store.removeAll()
}

Context.prototype.usernameAvailable = nodeify(function (username) {
  return loginCreate.usernameAvailable(this, username)
})

/**
 * Creates a login, then creates and attaches an account to it.
 */
Context.prototype.createAccount = nodeify(function (username, password, pin) {
  return loginCreate.create(this, username, password, {}).then(login => {
    try {
      login.accountFind(this.accountType)
    } catch (e) {
      // If the login doesn't have the correct account type, add it first:
      return login.accountCreate(this, this.accountType).then(() => {
        return loginPin2.setup(this, login, pin).then(() => {
          const account = new Account(this, login)
          account.newAccount = true
          return account.sync().then(() => account)
        })
      })
    }

    // Otherwise, we have the correct account type, and can simply return:
    return loginPin2.setup(this, login, pin).then(() => {
      const account = new Account(this, login)
      account.newAccount = true
      return account.sync().then(() => account)
    })
  })
})

Context.prototype.loginWithPassword = nodeify(function (username, password, otp, opts) {
  return loginPassword.login(this, username, password).then(login => {
    const account = new Account(this, login)
    account.passwordLogin = true
    return account.sync().then(() => account)
  })
})

Context.prototype.pinExists = function (username) {
  return loginPin2.getKey(this, username) != null
}
Context.prototype.pinLoginEnabled = function (username) {
  return loginPin2.getKey(this, username) != null
}

Context.prototype.loginWithPIN = nodeify(function (username, pin) {
  const pin2Key = loginPin2.getKey(this, username)
  if (!pin2Key) {
    throw new Error('No PIN set locally for this account')
  }
  return loginPin2.login(this, pin2Key, username, pin).then(login => {
    const account = new Account(this, login)
    account.pinLogin = true
    return account.sync().then(() => account)
  })
})

Context.prototype.getRecovery2Key = nodeify(function (username) {
  const userStorage = new UserStorage(this.localStorage, username)
  const recovery2Key = userStorage.getItem('recovery2Key')
  if (recovery2Key) {
    return Promise.resolve(recovery2Key)
  } else {
    return Promise.reject(new Error('No recovery key stored locally.'))
  }
})

Context.prototype.loginWithRecovery2 = nodeify(function (recovery2Key, username, answers, otp, options) {
  return loginRecovery2.login(this, recovery2Key, username, answers).then(login => {
    const account = new Account(this, login)
    account.recoveryLogin = true
    return account.sync().then(() => account)
  })
})

Context.prototype.fetchRecovery2Questions = nodeify(function (recovery2Key, username) {
  return loginRecovery2.questions(this, recovery2Key, username)
})

Context.prototype.runScryptTimingWithParameters = function (n, r, p) {
  const snrp = crypto.makeSnrp()
  // const snrp = {
  //   'salt_hex': crypto.random(32).toString('hex'),
  //   'n': 16384,
  //   'r': 1,
  //   'p': 1
  // }
  snrp.n = Math.pow(2, n)
  snrp.r = r
  snrp.p = p

  const hashTime = crypto.timeSnrp(snrp)

  return {
    time: hashTime
  }
}

Context.prototype.checkPasswordRules = function (password) {
  const tooShort = password.length < 10
  const noNumber = password.match(/\d/) == null
  const noUpperCase = password.match(/[A-Z]/) == null
  const noLowerCase = password.match(/[a-z]/) == null
  const extraLong = password.length >= 16

  return {
    'tooShort': tooShort,
    'noNumber': noNumber,
    'noUpperCase': noUpperCase,
    'noLowerCase': noLowerCase,
    'passed': extraLong || !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}

Context.prototype.requestEdgeLogin = nodeify(function (opts) {
  const onLogin = opts.onLogin
  opts.onLogin = (err, login) => {
    if (err) return onLogin(err)
    const account = new Account(this, login)
    account.edgeLogin = true
    account.sync().then(dirty => onLogin(null, account), err => onLogin(err))
  }
  opts.type = opts.type || this.accountType
  return loginEdge.create(this, opts)
})

Context.prototype.listRecoveryQuestionChoices = nodeify(function () {
  return loginRecovery2.listRecoveryQuestionChoices(this)
})
