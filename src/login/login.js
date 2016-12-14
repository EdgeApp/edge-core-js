import * as crypto from '../crypto.js'
import {base58} from '../util/encoding.js'
import * as server from './server.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'

/**
 * Unpacks a login v2 reply package, and stores the contents locally.
 */
function loginReplyStore (localStorage, username, dataKey, loginReply) {
  const userStorage = new UserStorage(localStorage, username)
  const keys = [
    // Password login:
    'passwordKeySnrp', 'passwordBox',
    // Key boxes:
    'passwordAuthBox', 'rootKeyBox', 'syncKeyBox', 'repos'
  ]

  // Store any keys the reply may contain:
  for (let key of keys) {
    if (loginReply[key]) {
      userStorage.setJson(key, loginReply[key])
    }
  }

  // Store the pin key unencrypted:
  const pin2KeyBox = loginReply['pin2KeyBox']
  if (pin2KeyBox) {
    const pin2Key = crypto.decrypt(pin2KeyBox, dataKey)
    userStorage.setItem('pin2Key', base58.encode(pin2Key))
  }

  // Store the recovery key unencrypted:
  const recovery2KeyBox = loginReply['recovery2KeyBox']
  if (recovery2KeyBox) {
    const recovery2Key = crypto.decrypt(recovery2KeyBox, dataKey)
    userStorage.setItem('recovery2Key', base58.encode(recovery2Key))
  }
}

/**
 * Access to the logged-in user data.
 *
 * This type has following powers:
 * - Access to the auth server
 * - A list of account repos
 * - The legacy BitID rootKey
 */
export function Login (localStorage, username, dataKey) {
  // Identity:
  this.username = username
  this.userId = userMap.getUserId(localStorage, username)

  // Access to the login data:
  this.dataKey = dataKey
  this.userStorage = new UserStorage(localStorage, username)

  // Return access to the server:
  const passwordAuthBox = this.userStorage.getJson('passwordAuthBox')
  if (!passwordAuthBox) {
    throw new Error('Missing passwordAuthBox')
  }
  this.passwordAuth = crypto.decrypt(passwordAuthBox, dataKey)

  // Account repo:
  this.repos = this.userStorage.getJson('repos') || []
  const syncKeyBox = this.userStorage.getJson('syncKeyBox')
  if (syncKeyBox) {
    this.syncKey = crypto.decrypt(syncKeyBox, dataKey)
  }

  // Legacy BitID key:
  const rootKeyBox = this.userStorage.getJson('rootKeyBox')
  if (rootKeyBox) {
    this.rootKey = crypto.decrypt(rootKeyBox, dataKey)
  }
}

/**
 * Returns a new login object, populated with data from the server.
 */
Login.online = function (localStorage, username, dataKey, loginReply) {
  loginReplyStore(localStorage, username, dataKey, loginReply)
  return new Login(localStorage, username, dataKey)
}

/**
 * Returns a new login object, populated with data from the local storage.
 */
Login.offline = function (localStorage, username, dataKey) {
  return new Login(localStorage, username, dataKey)
}

/**
 * Sets up a login v2 server authorization JSON.
 */
Login.prototype.authJson = function () {
  return {
    'userId': this.userId,
    'passwordAuth': this.passwordAuth.toString('base64')
  }
}

/**
 * Searches for the given account type in the provided login object.
 * Returns the repo keys in the JSON bundle format.
 */
Login.prototype.accountFind = function (type) {
  // Search the repos array:
  for (let repo of this.repos) {
    if (repo['type'] === type) {
      const keysBox = repo['keysBox'] || repo['info']
      return JSON.parse(crypto.decrypt(keysBox, this.dataKey).toString('utf-8'))
    }
  }

  // Handle the legacy Airbitz repo:
  if (type === 'account:repo:co.airbitz.wallet') {
    return {
      'syncKey': this.syncKey.toString('hex'),
      'dataKey': this.dataKey.toString('hex')
    }
  }

  throw new Error('Cannot find a \'' + type + '\' repo')
}

/**
 * Creates and attaches new account repo.
 */
Login.prototype.accountCreate = function (ctx, type) {
  return server.repoCreate(ctx, this, {}).then(keysJson => {
    return this.accountAttach(ctx, type, keysJson).then(() => {
      return server.repoActivate(ctx, this, keysJson)
    })
  })
}

/**
 * Attaches an account repo to the login.
 */
Login.prototype.accountAttach = function (ctx, type, info) {
  const infoBlob = new Buffer(JSON.stringify(info), 'utf-8')
  const data = {
    'type': type,
    'info': crypto.encrypt(infoBlob, this.dataKey)
  }

  const request = this.authJson()
  request['data'] = data
  return ctx.authRequest('POST', '/v2/login/repos', request).then(reply => {
    this.repos.push(data)
    this.userStorage.setJson('repos', this.repos)
    return null
  })
}
