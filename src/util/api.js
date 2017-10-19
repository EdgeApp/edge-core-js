import { rejectify } from '../util/decorators.js'

/**
 * Prepares an async API endpoint for consumption by the outside world.
 */
function asyncApi (f, name) {
  return function asyncApi (...rest) {
    console.info(name)
    const promise = rejectify(f)
      .apply(this, rest)
      .catch(e => {
        console.info(name, e)
        throw e
      })

    // Figure out what to do with the promise:
    const callback = rest[rest.length - 1]
    if (f.length < rest.length && typeof callback === 'function') {
      promise.then(reply => callback(null, reply)).catch(e => {
        console.info(name, e)
        callback(e)
      })
    } else {
      return promise
    }
  }
}

/**
 * Prepares a sync API endploint for consumption by the outside world.
 */
function syncApi (f, name) {
  return function syncApi (...rest) {
    console.info(name)
    try {
      return f.apply(this, rest)
    } catch (e) {
      console.info(name, e)
      throw e
    }
  }
}

/**
 * Adjusts a property decscriptor, making the property ready for use as an API.
 */
function wrapProperty (key, d, className, opts = {}) {
  // Wrap functions:
  if (typeof d.value === 'function') {
    const name = `${className}.${key}`
    d.value = opts.sync ? syncApi(d.value, name) : asyncApi(d.value, name)
  }
  if (d.get != null) {
    d.get = syncApi(d.get, `get ${className}.${key}`)
  }
  if (d.set != null) {
    d.set = syncApi(d.set, `set ${className}.${key}`)
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
export function wrapObject (className, object) {
  const out = {}

  for (const key of Object.getOwnPropertyNames(object)) {
    // Skip over options:
    if (/^@/.test(key)) continue

    // Copy properties:
    const d = Object.getOwnPropertyDescriptor(object, key)
    const opts = object['@' + key]
    Object.defineProperty(out, key, wrapProperty(key, d, className, opts))
  }

  return out
}

export function copyProperties (target, object) {
  for (const key of Object.getOwnPropertyNames(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key)
    Object.defineProperty(target, key, d)
  }
  return target
}
