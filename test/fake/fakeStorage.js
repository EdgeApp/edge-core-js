/**
 * Emulates the `localStorage` browser API.
 */
export function FakeStorage () {
  this.items = {}
}
FakeStorage.prototype.getItem = function (key) {
  return key in this.items ? this.items[key] : null
}
FakeStorage.prototype.setItem = function (key, value) {
  this.items[key] = value
}
FakeStorage.prototype.removeItem = function (key) {
  delete this.items[key]
}
FakeStorage.prototype.key = function (n) {
  return Object.keys(this.items)[n]
}
Object.defineProperty(FakeStorage.prototype, 'length', {
  get: function () {
    return Object.keys(this.items).length
  }
})

/**
 * Empties the `FakeStorage` instance.
 */
FakeStorage.prototype.clear = function () {
  this.items = {}
}
