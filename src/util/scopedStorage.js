/**
 * Wraps `LocalStorage` with a namespace and other extra goodies.
 */
function ScopedStorage (localStorage, prefix) {
  this.localStorage = localStorage
  this.prefix = prefix + '.'
}
exports.ScopedStorage = ScopedStorage

ScopedStorage.prototype.getItem = function (key) {
  return this.localStorage.getItem(this.prefix + key)
}

ScopedStorage.prototype.setItem = function (key, value) {
  return this.localStorage.setItem(this.prefix + key, value)
}

ScopedStorage.prototype.removeItem = function (key) {
  return this.localStorage.removeItem(this.prefix + key)
}

ScopedStorage.prototype.getJson = function (key) {
  var text = this.getItem(key)
  return text == null ? null : JSON.parse(text)
}

ScopedStorage.prototype.setJson = function (key, value) {
  return this.setItem(key, JSON.stringify(value))
}

ScopedStorage.prototype.subStore = function (prefix) {
  return new ScopedStorage(this.localStorage, this.prefix + prefix)
}
