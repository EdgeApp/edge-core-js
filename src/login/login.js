import * as crypto from '../crypto/crypto.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
import {base16, base58, base64, utf8} from '../util/encoding.js'
import * as server from './server.js'

/**
 * Unpacks a login v2 reply package, and stores the contents locally.
 */
function loginReplyStore (io, username, dataKey, loginReply) {
  const userStorage = new UserStorage(io.localStorage, username)
  const keys = [
    // Password login:
    'passwordKeySnrp', 'passwordBox',
    // Key boxes:
    'passwordAuthBox', 'rootKeyBox', 'syncKeyBox', 'repos'
  ]

  // Store any keys the reply may contain:
  keys.forEach(key => {
    if (loginReply[key]) {
      userStorage.setJson(key, loginReply[key])
    }
  })

  // Store the pin key unencrypted:
  const pin2KeyBox = loginReply['pin2KeyBox']
  if (pin2KeyBox) {
    const pin2Key = crypto.decrypt(pin2KeyBox, dataKey)
    userStorage.setItem('pin2Key', base58.stringify(pin2Key))
  }

  // Store the recovery key unencrypted:
  const recovery2KeyBox = loginReply['recovery2KeyBox']
  if (recovery2KeyBox) {
    const recovery2Key = crypto.decrypt(recovery2KeyBox, dataKey)
    userStorage.setItem('recovery2Key', base58.stringify(recovery2Key))
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
export function Login (io, username, userId, dataKey) {
  if (userId.length !== 32) {
    throw new Error('userId must be a hash')
  }

  // Identity:
  this.username = username
  this.userId = userId

  // Access to the login data:
  this.dataKey = dataKey
  this.userStorage = new UserStorage(io.localStorage, username)

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

  // Local keys:
  const pin2Key = this.userStorage.getItem('pin2Key')
  if (pin2Key) {
    this.pin2Key = base58.parse(pin2Key)
  }
  const recovery2Key = this.userStorage.getItem('recovery2Key')
  if (recovery2Key) {
    this.recovery2Key = base58.parse(recovery2Key)
  }
}

/**
 * Returns a new login object, populated with data from the server.
 */
Login.online = function (io, username, userId, dataKey, loginReply) {
  userMap.insert(io, username, userId)
  loginReplyStore(io, username, dataKey, loginReply)
  return new Login(io, username, userId, dataKey)
}

/**
 * Returns a new login object, populated with data from the local storage.
 */
Login.offline = function (io, username, userId, dataKey) {
  const out = new Login(io, username, userId, dataKey)

  // Try updating our locally-stored login data (failure is ok):
  io
    .authRequest('POST', '/v2/login', out.authJson())
    .then(reply => loginReplyStore(io, username, dataKey, reply))
    .catch(e => io.log.error(e))

  return out
}

/**
 * Sets up a login v2 server authorization JSON.
 */
Login.prototype.authJson = function () {
  return {
    'userId': base64.stringify(this.userId),
    'passwordAuth': base64.stringify(this.passwordAuth)
  }
}

/**
 * Searches for the given account type in the provided login object.
 * Returns the repo keys in the JSON bundle format.
 */
Login.prototype.accountFind = function (type) {
  // Search the repos array:
  for (const repo of this.repos) {
    if (repo['type'] === type) {
      const keysBox = repo['keysBox'] || repo['info']
      return JSON.parse(utf8.stringify(crypto.decrypt(keysBox, this.dataKey)))
    }
  }

  // Handle the legacy Airbitz repo:
  if (type === 'account:repo:co.airbitz.wallet') {
    return {
      'syncKey': base16.stringify(this.syncKey),
      'dataKey': base16.stringify(this.dataKey)
    }
  }

  throw new Error(`Cannot find a "${type}" repo`)
}

/**
 * Creates and attaches new account repo.
 */
Login.prototype.accountCreate = function (io, type) {
  return server.repoCreate(io, this, {}).then(keysJson => {
    return this.accountAttach(io, type, keysJson).then(() => {
      return server.repoActivate(io, this, keysJson)
    })
  })
}

/**
 * Attaches an account repo to the login.
 */
Login.prototype.accountAttach = function (io, type, info) {
  const infoBlob = utf8.parse(JSON.stringify(info))
  const data = {
    'type': type,
    'info': crypto.encrypt(io, infoBlob, this.dataKey)
  }

  const request = this.authJson()
  request['data'] = data
  return io.authRequest('POST', '/v2/login/repos', request).then(reply => {
    this.repos.push(data)
    this.userStorage.setJson('repos', this.repos)
    return null
  })
}
