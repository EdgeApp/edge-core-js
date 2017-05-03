import { encrypt, hmacSha256 } from '../crypto/crypto.js'
import { base16, base64, utf8 } from '../util/encoding.js'
import { softCat } from '../util/util.js'
import { makeAuthJson, mergeKeyInfos } from './login.js'

export function makeAccountType (appId) {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

/**
 * Assembles the key metadata structure that is encrypted within a keyBox.
 * @param idKey Used to derive the wallet id. It's usually `dataKey`.
 */
export function makeKeyInfo (keys, type, idKey) {
  return {
    id: base64.stringify(hmacSha256(idKey, utf8.parse(type))),
    type,
    keys
  }
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit (io, login, keyInfos, newSyncKeys = []) {
  const keyBoxes = keyInfos.map(info =>
    encrypt(io, utf8.parse(JSON.stringify(info)), login.loginKey)
  )

  return {
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
  const kit = makeKeysKit(io, login, keyInfos, syncKeys)

  const request = makeAuthJson(login)
  request.data = kit.server
  return io.authRequest('POST', '/v2/login/keys', request).then(reply => {
    login.keyInfos = mergeKeyInfos([...login.keyInfos, ...kit.login.keyInfos])
    return io.loginStore.update(loginTree, login, stash => {
      stash.keyBoxes = softCat(stash.keyBoxes, kit.stash.keyBoxes)
      return stash
    })
  })
}
