/**
 * Returns a wrapped version of `localStorage` keyed to a specific user.
 */
function UserStorage (localStorage, username) {
  this.localStorage = localStorage
  this.prefix = 'airbitz.user.' + username + '.'
}

UserStorage.prototype.getItem = function (key) {
  return this.localStorage.getItem(this.prefix + key)
}

UserStorage.prototype.setItem = function (key, value) {
  return this.localStorage.setItem(this.prefix + key, value)
}

UserStorage.prototype.removeItem = function (key) {
  return this.localStorage.removeItem(this.prefx + key)
}

UserStorage.prototype.getJson = function (key) {
  try {
    return JSON.parse(this.getItem(key))
  } catch (e) {
    return null
  }
}

UserStorage.prototype.setJson = function (key, value) {
  return this.setItem(key, JSON.stringify(value))
}

exports.UserStorage = UserStorage
