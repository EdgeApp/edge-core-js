import * as crypto from '../crypto/crypto.js'
import {fixUsername} from '../io/loginStore.js'
import {base16, base58, base64, utf8} from '../util/encoding.js'
import { filterObject } from '../util/util.js'
import * as server from './server.js'

/**
 * Converts a login reply from the server into the local storage format.
 */
function makeLoginStash (username, loginReply, loginKey) {
  // Copy common items:
  const out = filterObject(loginReply, [
    'passwordAuthBox',
    'passwordBox',
    'passwordKeySnrp',
    'rootKeyBox',
    'syncKeyBox',
    'repos'
  ])

  // Store the normalized username:
  out.username = fixUsername(username)

  // Store the pin key unencrypted:
  if (loginReply.pin2KeyBox != null) {
    const pin2Key = crypto.decrypt(loginReply.pin2KeyBox, loginKey)
    out.pin2Key = base58.stringify(pin2Key)
  }

  // Store the recovery key unencrypted:
  if (loginReply.recovery2KeyBox != null) {
    const recovery2Key = crypto.decrypt(loginReply.recovery2KeyBox, loginKey)
    out.recovery2Key = base58.stringify(recovery2Key)
  }

  return out
}

/**
 * Access to the logged-in user data.
 *
 * This type has following powers:
 * - Access to the auth server
 * - A list of account repos
 * - The legacy BitID rootKey
 */
export function Login (io, userId, loginKey, loginStash) {
  if (userId.length !== 32) {
    throw new Error('userId must be a hash')
  }

  // Identity:
  this.username = loginStash.username
  this.userId = userId
  this.loginKey = loginKey

  // Return access to the server:
  if (loginStash.passwordAuthBox == null) {
    throw new Error('Missing passwordAuthBox')
  }
  this.passwordAuth = crypto.decrypt(loginStash.passwordAuthBox, loginKey)

  // Legacy account repo:
  if (loginStash.syncKeyBox != null) {
    this.syncKey = crypto.decrypt(loginStash.syncKeyBox, loginKey)
  }

  // Legacy BitID key:
  if (loginStash.rootKeyBox != null) {
    this.rootKey = crypto.decrypt(loginStash.rootKeyBox, loginKey)
  }

  // TODO: Decrypt these:
  this.repos = loginStash.repos || []

  // Local keys:
  if (loginStash.pin2Key != null) {
    this.pin2Key = base58.parse(loginStash.pin2Key)
  }
  if (loginStash.recovery2Key != null) {
    this.recovery2Key = base58.parse(loginStash.recovery2Key)
  }
}

/**
 * Returns a new login object, populated with data from the server.
 */
Login.online = function (io, username, userId, loginKey, loginReply) {
  const loginStash = makeLoginStash(username, loginReply, loginKey)
  io.loginStore.update(userId, loginStash)

  return new Login(io, userId, loginKey, loginStash)
}

/**
 * Returns a new login object, populated with data from the local storage.
 */
Login.offline = function (io, username, userId, loginKey) {
  const loginStash = io.loginStore.find({username})
  const out = new Login(io, userId, loginKey, loginStash)

  // Try updating our locally-stored login data (failure is ok):
  io
    .authRequest('POST', '/v2/login', out.authJson())
    .then(loginReply => {
      const loginStash = makeLoginStash(username, loginReply, loginKey)
      return io.loginStore.update(userId, loginStash)
    })
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
      return JSON.parse(utf8.stringify(crypto.decrypt(keysBox, this.loginKey)))
    }
  }

  // Handle the legacy Airbitz repo:
  if (type === 'account:repo:co.airbitz.wallet') {
    return {
      'syncKey': base16.stringify(this.syncKey),
      'dataKey': base16.stringify(this.loginKey)
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
    'info': crypto.encrypt(io, infoBlob, this.loginKey)
  }

  const request = this.authJson()
  request['data'] = data
  return io.authRequest('POST', '/v2/login/repos', request).then(reply => {
    this.repos.push(data)
    io.loginStore.update(this.userId, {repos: this.repos})
    return null
  })
}
