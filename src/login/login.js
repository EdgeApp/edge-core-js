/**
 * Functions for working with login data in its on-disk format.
 */

import { decrypt, encrypt, hmacSha256 } from '../crypto/crypto.js'
import { base16, base58, base64, utf8 } from '../util/encoding.js'
import { filterObject, objectAssign } from '../util/util.js'
import { makeAccountType } from '../account.js'

/**
 * Updates the given loginStash object with fields from the auth server.
 * TODO: We don't trust the auth server 100%, so be picky about what we copy.
 */
export function applyLoginReply (loginStash, loginKey, loginReply) {
  // Copy common items:
  const out = filterObject(loginReply, [
    'appId',
    'passwordAuthBox',
    'passwordBox',
    'passwordKeySnrp',
    'rootKeyBox',
    'mnemonicBox',
    'syncKeyBox'
  ])

  out.username = loginStash.username
  out.userId = loginStash.userId

  // Store the pin key unencrypted:
  if (loginReply.pin2KeyBox != null) {
    const pin2Key = decrypt(loginReply.pin2KeyBox, loginKey)
    out.pin2Key = base58.stringify(pin2Key)
  }

  // Store the recovery key unencrypted:
  if (loginReply.recovery2KeyBox != null) {
    const recovery2Key = decrypt(loginReply.recovery2KeyBox, loginKey)
    out.recovery2Key = base58.stringify(recovery2Key)
  }

  // Keys (we could be more picky about this):
  out.keyBoxes = loginReply.keyBoxes != null ? loginReply.keyBoxes : []

  return out
}

/**
 * Converts a loginStash into an in-memory login object.
 */
export function makeLogin (loginStash, loginKey) {
  const login = {}

  login.username = loginStash.username

  // Identity:
  if (loginStash.appId == null) {
    throw new Error('No appId provided')
  }
  login.appId = loginStash.appId
  login.userId = base64.parse(loginStash.userId)
  login.loginKey = loginKey

  // Return access to the server:
  if (loginStash.passwordAuthBox == null) {
    throw new Error('Missing passwordAuthBox')
  }
  login.passwordAuth = decrypt(loginStash.passwordAuthBox, loginKey)

  const legacyKeys = []

  // BitID wallet:
  if (loginStash.menemonicBox != null && loginStash.rootKeyBox != null) {
    const mnemonic = utf8.stringify(decrypt(loginStash.menemonicBox, loginKey))
    const rootKey = decrypt(loginStash.rootKeyBox, loginKey)
    const keysJson = {
      mnemonic,
      rootKey: base64.stringify(rootKey)
    }
    legacyKeys.push(makeKeyInfo(keysJson, 'wallet:bitid', rootKey))
  }

  // Account settings:
  if (loginStash.syncKeyBox != null) {
    const syncKey = decrypt(loginStash.syncKeyBox, loginKey)
    const type = makeAccountType(login.appId)
    const keysJson = {
      syncKey: base64.stringify(syncKey),
      dataKey: base64.stringify(loginKey)
    }
    legacyKeys.push(makeKeyInfo(keysJson, type, loginKey))
  }

  // Keys:
  const keyInfos = loginStash.keyBoxes.map(box =>
    JSON.parse(utf8.stringify(decrypt(box, loginKey))))

  login.keyInfos = mergeKeyInfos([...legacyKeys, ...keyInfos])

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
 * Sets up a login v2 server authorization JSON.
 */
export function makeAuthJson (login) {
  return {
    'userId': base64.stringify(login.userId),
    'passwordAuth': base64.stringify(login.passwordAuth)
  }
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
    encrypt(io, utf8.parse(JSON.stringify(info)), login.loginKey))

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
 * Flattens an array of key structures, removing duplicates.
 */
export function mergeKeyInfos (keyInfos) {
  const ids = [] // All ID's, in order of appearance
  const keys = {} // All keys, indexed by id
  const types = {} // Key types, indexed by id

  keyInfos.forEach(info => {
    const id = info.id
    if (id == null || base64.parse(id).length !== 32) {
      throw new Error(`Key integrity violation: invalid id ${id}`)
    }

    if (keys[id] == null) {
      // The id is new, so just insert the keys:
      ids.push(id)
      keys[id] = objectAssign({}, info.keys)
      types[id] = info.type
    } else {
      // An object with this ID already exists, so update it:
      if (types[id] !== info.type) {
        throw new Error(
          `Key integrity violation for ${id}: type ${info.type} does not match ${types[id]}`
        )
      }
      info.keys.forEach(key => {
        if (keys[id][key] && keys[id][key] !== info.keys[key]) {
          throw new Error(
            `Key integrity violation for ${id}: ${key} keys do not match`
          )
        }
        keys[id][key] = info.keys[key]
      })
    }
  })

  return ids.map(id => {
    return {
      id,
      keys: keys[id],
      type: types[id]
    }
  })
}

/**
 * Attaches keys to the login object,
 * optionally creating any repos needed.
 */
export function attachKeys (io, login, keyInfos, syncKeys = []) {
  const kit = makeKeysKit(io, login, keyInfos, syncKeys)

  const request = makeAuthJson(login)
  request.data = kit.server
  return io.authRequest('POST', '/v2/login/keys', request).then(reply => {
    login.keyInfos = mergeKeyInfos([...login.keyInfos, ...kit.login.keyInfos])
    const oldKeys = io.loginStore.loadSync(login.username).keyBoxes
    io.loginStore.update(login.userId, {
      keys: [...oldKeys, ...kit.stash.keyBoxes]
    })
    return login
  })
}
