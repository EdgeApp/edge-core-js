// @flow
import type { AbcWalletInfo } from 'airbitz-core-types'
import { encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { base16, base64, utf8 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import type {
  LoginKit,
  StorageWalletInfo,
  LoginTree,
  StorageKeys
} from './login-types.js'

/**
 * Returns the first keyInfo with a matching type.
 */
export function findFirstKey (keyInfos: Array<AbcWalletInfo>, type: string) {
  return keyInfos.find(info => info.type === type)
}

export function makeAccountType (appId: string) {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

/**
 * Assembles the key metadata structure that is encrypted within a keyBox.
 * @param idKey Used to derive the wallet id. It's usually `dataKey`.
 */
export function makeKeyInfo (type: string, keys: {}, idKey: Uint8Array) {
  return {
    id: base64.stringify(hmacSha256(utf8.parse(type), idKey)),
    type,
    keys
  }
}

/**
 * Makes keys for accessing an encrypted Git repo.
 */
export function makeStorageKeyInfo (
  ai: ApiInput,
  type: string,
  keys: StorageKeys = {}
) {
  const { io } = ai.props
  if (keys.dataKey == null) keys.dataKey = base64.stringify(io.random(32))
  if (keys.syncKey == null) keys.syncKey = base64.stringify(io.random(20))

  return makeKeyInfo(type, keys, base64.parse(keys.dataKey))
}

/**
 * Assembles all the resources needed to attach new keys to the account.
 */
export function makeKeysKit (
  ai: ApiInput,
  login: LoginTree,
  ...keyInfos: Array<StorageWalletInfo>
): LoginKit {
  const { io } = ai.props
  const keyBoxes = keyInfos.map(info =>
    encrypt(io, utf8.parse(JSON.stringify(info)), login.loginKey)
  )
  const newSyncKeys: Array<string> = []
  for (const info of keyInfos) {
    if (info.keys.syncKey != null) {
      newSyncKeys.push(base16.stringify(base64.parse(info.keys.syncKey)))
    }
  }

  return {
    serverPath: '/v2/login/keys',
    server: { keyBoxes, newSyncKeys },
    stash: { keyBoxes },
    login: { keyInfos },
    loginId: login.loginId
  }
}

/**
 * Flattens an array of key structures, removing duplicates.
 */
export function mergeKeyInfos (keyInfos: Array<AbcWalletInfo>) {
  const out = []
  const ids = {} // Maps ID's to output array indexes

  for (const keyInfo of keyInfos) {
    const { id, type, keys } = keyInfo
    if (id == null || base64.parse(id).length !== 32) {
      throw new Error(`Key integrity violation: invalid id ${id}`)
    }

    if (ids[id] != null) {
      // We have already seen this id, so check for conflicts:
      const old = out[ids[id]]
      if (old.type !== type) {
        throw new Error(
          `Key integrity violation for ${id}: type ${type} does not match ${old.type}`
        )
      }
      for (const key of Object.keys(keys)) {
        if (old.keys[key] != null && old.keys[key] !== keys[key]) {
          throw new Error(
            `Key integrity violation for ${id}: ${key} keys do not match`
          )
        }
      }

      // Do the update:
      out[ids[id]] = { id, type, keys: { ...old.keys, ...keys } }
    } else {
      // We haven't seen this id, so insert it:
      ids[id] = out.length
      out.push(keyInfo)
    }
  }

  return out
}
