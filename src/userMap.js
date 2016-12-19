import * as crypto from './crypto/crypto.js'

/**
 * Returns the user map, which goes from usernames to userId's
 */
export function load (localStorage) {
  try {
    const userMap = JSON.parse(localStorage.getItem('airbitz.users'))
    return userMap || {}
  } catch (e) {
    return {}
  }
}

/**
 * Ensures that the userMap contains the given user. Adds the user if not.
 */
export function insert (localStorage, username, userId) {
  const userMap = load(localStorage)
  userMap[username] = userId
  localStorage.setItem('airbitz.users', JSON.stringify(userMap))
}

/**
 * Removes a username from the map.
 */
export function remove (localStorage, username) {
  const userMap = load(localStorage)
  delete userMap[username]
  localStorage.setItem('airbitz.users', JSON.stringify(userMap))
}

/**
 * Computes the userId (L1) for the given username.
 */
export function getUserId (localStorage, username) {
  const userMap = load(localStorage)
  return userMap[username] ||
    crypto.scrypt(username, crypto.userIdSnrp).toString('base64')
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
