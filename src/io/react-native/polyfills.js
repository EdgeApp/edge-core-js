/* eslint-disable no-extend-native */

/**
 * Object.assign
 */
function assign(out, args) {
  if (out == null) {
    throw new TypeError('Cannot convert undefined or null to object')
  }
  out = Object(out)

  for (let i = 1; i < arguments.length; ++i) {
    const from = arguments[i]
    if (from == null) continue

    for (const key in from) {
      if (Object.prototype.hasOwnProperty.call(from, key)) {
        out[key] = from[key]
      }
    }
  }
  return out
}

/**
 * Array.fill
 */
function fill(value, start, end) {
  const length = this.length
  function clamp(endpoint) {
    return endpoint < 0
      ? Math.max(length + endpoint, 0)
      : Math.min(endpoint, length)
  }
  const first = clamp(start != null ? start : 0)
  const last = clamp(end != null ? end : length)

  for (let i = first; i < last; ++i) {
    this[i] = value
  }
  return this
}

/**
 * Array.find
 */
function find(test, testThis) {
  for (let i = 0; i < this.length; ++i) {
    const value = this[i]
    if (test.call(testThis, value, i, this)) {
      return value
    }
  }
}

/**
 * Array.includes
 */
function includes(target) {
  return Array.prototype.indexOf.call(this, target) >= 0
}

// Perform the polyfill:
if (typeof Object.assign !== 'function') {
  Object.defineProperty(Object, 'assign', {
    configurable: true,
    writable: true,
    value: assign
  })
}
if (typeof Array.prototype.fill !== 'function') {
  Array.prototype.fill = fill
}
if (typeof Array.prototype.find !== 'function') {
  Array.prototype.find = find
}
if (Array.prototype.includes !== 'function') {
  Array.prototype.includes = includes
}
if (typeof Uint8Array.prototype.fill !== 'function') {
  Uint8Array.prototype.fill = Array.prototype.fill
}
