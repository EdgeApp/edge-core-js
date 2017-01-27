import * as scrypt from './crypto/scrypt.js'
import {base64} from './util/encoding.js'

/**
 * Returns the user map, which goes from usernames to userId's
 */
export function load (io) {
  try {
    const userMap = JSON.parse(io.localStorage.getItem('airbitz.users'))
    return userMap || {}
  } catch (e) {
    return {}
  }
}

/**
 * Ensures that the userMap contains the given user. Adds the user if not.
 */
export function insert (io, username, userId) {
  const userMap = load(io)
  userMap[username] = userId
  io.localStorage.setItem('airbitz.users', JSON.stringify(userMap))
}

/**
 * Removes a username from the map.
 */
export function remove (io, username) {
  const userMap = load(io)
  delete userMap[username]
  io.localStorage.setItem('airbitz.users', JSON.stringify(userMap))
}

/**
 * Computes the userId (L1) for the given username.
 */
export function getUserId (io, username) {
  const userMap = load(io)
  if (userMap[username]) {
    return Promise.resolve(userMap[username])
  }
  return scrypt.scrypt(username, scrypt.userIdSnrp).then(userId => base64.stringify(userId))
}

/**
 * Normalizes a username, and checks for invalid characters.
 */
export function normalize (username) {
  let out = username + ''
  out = out.toLowerCase()
    .replace(/[ \f\r\n\t\v]+/g, ' ')
    .replace(/ $/, '')
    .replace(/^ /, '')

  for (let i = 0; i < out.length; ++i) {
    const c = out.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) {
      throw new Error('Bad characters in username')
    }
  }
  return out
}
