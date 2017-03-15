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
function makeLogin (io, userId, loginKey, loginStash) {
  const login = {}

  if (userId.length !== 32) {
    throw new Error('userId must be a hash')
  }

  // Identity:
  login.username = loginStash.username
  login.userId = userId
  login.loginKey = loginKey

  // Return access to the server:
  if (loginStash.passwordAuthBox == null) {
    throw new Error('Missing passwordAuthBox')
  }
  login.passwordAuth = crypto.decrypt(loginStash.passwordAuthBox, loginKey)

  // Legacy account repo:
  if (loginStash.syncKeyBox != null) {
    login.syncKey = crypto.decrypt(loginStash.syncKeyBox, loginKey)
  }

  // Legacy BitID key:
  if (loginStash.rootKeyBox != null) {
    login.rootKey = crypto.decrypt(loginStash.rootKeyBox, loginKey)
  }

  // TODO: Decrypt these:
  login.repos = loginStash.repos || []

  // Local keys:
  if (loginStash.pin2Key != null) {
    login.pin2Key = base58.parse(loginStash.pin2Key)
  }
  if (loginStash.recovery2Key != null) {
    login.recovery2Key = base58.parse(loginStash.recovery2Key)
  }

  return login
}

/**
 * Returns a new login object, populated with data from the server.
 */
export function loginOnline (io, username, userId, loginKey, loginReply) {
  const loginStash = makeLoginStash(username, loginReply, loginKey)
  io.loginStore.update(userId, loginStash)

  return makeLogin(io, userId, loginKey, loginStash)
}

/**
 * Returns a new login object, populated with data from the local storage.
 */
export function loginOffline (io, loginKey, loginStash) {
  const login = makeLogin(io, base64.parse(loginStash.userId), loginKey, loginStash)

  // Try updating our locally-stored login data (failure is ok):
  io
    .authRequest('POST', '/v2/login', makeAuthJson(login))
    .then(loginReply => {
      loginStash = makeLoginStash(login.username, loginReply, loginKey)
      return io.loginStore.update(login.userId, loginStash)
    })
    .catch(e => io.log.error(e))

  return login
}

/**
 * Sets up a login v2 server authorization JSON.
 */
export function makeAuthJson (login) {
  return {
    'userId': base64.stringify(login.userId),
    'passwordAuth': base64.stringify(login.passwordAuth)
  }
}

/**
 * Searches for the given account type in the provided login object.
 * Returns the repo keys in the JSON bundle format.
 */
export function findAccount (login, type) {
  // Search the repos array:
  for (const repo of login.repos) {
    if (repo['type'] === type) {
      const keysBox = repo['keysBox'] || repo['info']
      return JSON.parse(utf8.stringify(crypto.decrypt(keysBox, login.loginKey)))
    }
  }

  // Handle the legacy Airbitz repo:
  if (type === 'account:repo:co.airbitz.wallet') {
    return {
      'syncKey': base16.stringify(login.syncKey),
      'dataKey': base16.stringify(login.loginKey)
    }
  }

  throw new Error(`Cannot find a "${type}" repo`)
}

/**
 * Creates and attaches new account repo.
 */
export function createAccount (io, login, type) {
  return server.repoCreate(io, login, {}).then(keysJson => {
    return attachAccount(io, login, type, keysJson).then(() => {
      return server.repoActivate(io, login, keysJson)
    })
  })
}

/**
 * Attaches an account repo to the login.
 */
export function attachAccount (io, login, type, info) {
  const infoBlob = utf8.parse(JSON.stringify(info))
  const data = {
    'type': type,
    'info': crypto.encrypt(io, infoBlob, login.loginKey)
  }

  const request = makeAuthJson(login)
  request['data'] = data
  return io.authRequest('POST', '/v2/login/repos', request).then(reply => {
    login.repos.push(data)
    io.loginStore.update(login.userId, {repos: login.repos})
    return null
  })
}
