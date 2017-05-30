import { rejectify } from '../util/decorators.js'

/**
 * Prepares an async API endpoint for consumption by the outside world.
 */
function asyncApi (f, log, name) {
  return function asyncApi (...rest) {
    const promise = rejectify(f).apply(this, rest).catch(e => {
      log.error(name, e)
      throw e
    })

    // Figure out what to do with the promise:
    const callback = rest[rest.length - 1]
    if (f.length < rest.length && typeof callback === 'function') {
      promise.then(reply => callback(null, reply)).catch(e => callback(e))
    } else {
      return promise
    }
  }
}

/**
 * Prepares a sync API endploint for consumption by the outside world.
 */
function syncApi (f, log, name) {
  return function syncApi (...rest) {
    try {
      return f.apply(this, rest)
    } catch (e) {
      log.error(name, e)
      throw e
    }
  }
}

/**
 * Adjusts a property decscriptor, making the property ready for use as an API.
 */
function wrapProperty (key, d, log, className, opts = {}) {
  // Wrap functions:
  if (typeof d.value === 'function') {
    const name = `${className}.${key}`
    d.value = opts.sync
      ? syncApi(d.value, log, name)
      : asyncApi(d.value, log, name)
  }
  if (d.get != null) {
    d.get = syncApi(d.get, log, `get ${className}.${key}`)
  }
  if (d.set != null) {
    d.set = syncApi(d.set, log, `set ${className}.${key}`)
  }

  // Properties are read-only by default:
  if (!opts.writable && d.get == null && d.set == null) {
    d.writable = false
  }

  return d
}

/**
 * Copies the provided object, making its properties ready for use as an API.
 * If a property name starts with `@`, it is treated as an options structure.
 */
export function wrapObject (log, className, object) {
  const out = {}

  Object.getOwnPropertyNames(object).forEach(key => {
    // Skip over options:
    if (/^@/.test(key)) return

    // Copy properties:
    const d = Object.getOwnPropertyDescriptor(object, key)
    const opts = object['@' + key]
    Object.defineProperty(out, key, wrapProperty(key, d, log, className, opts))
  })

  return out
}

export function copyProperties (target, object) {
  Object.getOwnPropertyNames(object).forEach(key => {
    const d = Object.getOwnPropertyDescriptor(object, key)
    Object.defineProperty(target, key, d)
  })
  return target
}
