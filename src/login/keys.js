import { encrypt, hmacSha256 } from '../crypto/crypto.js'
import { base16, base64, utf8 } from '../util/encoding.js'
import { dispatchKit } from './login.js'

export function makeAccountType (appId) {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

/**
 * Assembles the key metadata structure that is encrypted within a keyBox.
 * @param idKey Used to derive the wallet id. It's usually `dataKey`.
 */
export function makeKeyInfo (type, keys, idKey) {
  return {
    id: base64.stringify(hmacSha256(idKey, utf8.parse(type))),
    type,
    keys
  }
}

/**
 * Make a kit for attaching a repo to a login.
 */
export function makeRepoKit (io, login, type, keys = {}) {
  if (keys.dataKey == null) keys.dataKey = base64.stringify(io.random(32))
  if (keys.syncKey == null) keys.syncKey = base64.stringify(io.random(20))
  const dataKey = base64.parse(keys.dataKey)
  const syncKey = base64.parse(keys.syncKey)

  const keyInfo = makeKeyInfo(type, keys, dataKey)
  return makeKeysKit(io, login, [keyInfo], [syncKey])
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit (io, login, keyInfos, newSyncKeys = []) {
  const keyBoxes = keyInfos.map(info =>
    encrypt(io, utf8.parse(JSON.stringify(info)), login.loginKey)
  )

  return {
    serverPath: '/v2/login/keys',
    server: {
      keyBoxes,
      newSyncKeys: newSyncKeys.map(syncKey => base16.stringify(syncKey))
    },
    stash: { keyBoxes },
    login: { keyInfos }
  }
}

/**
 * Attaches keys to the login object,
 * optionally creating any repos needed.
 */
export function attachKeys (io, loginTree, login, keyInfos, syncKeys = []) {
  return dispatchKit(
    io,
    loginTree,
    login,
    makeKeysKit(io, login, keyInfos, syncKeys)
  )
}
