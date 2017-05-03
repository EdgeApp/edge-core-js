import { rejectify } from '../util/decorators.js'

/**
 * Prepares an async API endpoint for consumption by the outside world.
 */
export function asyncApi (f, name) {
  return function asyncApi (...rest) {
    const promise = rejectify(f).apply(this, rest).catch(e => {
      this.io.log.error(name, e)
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
export function syncApi (f, name) {
  return function syncApi (...rest) {
    try {
      return f.apply(this, rest)
    } catch (e) {
      this.io.log.error(name, e)
      throw e
    }
  }
}

function wrapApi (f, name, opts = {}) {
  return opts.sync ? syncApi(f, name) : asyncApi(f, name)
}

/**
 * Decorates the functions in the provided prototype object,
 * making them ready for use as an API.
 */
export function wrapPrototype (className, template) {
  const out = {}

  Object.getOwnPropertyNames(template).forEach(key => {
    if (/^@/.test(key)) return
    const d = Object.getOwnPropertyDescriptor(template, key)
    const opts = template['@' + key]

    // Wrap the value:
    if (typeof d.value === 'function') {
      d.value = wrapApi(d.value, `${className}.${key}`, opts)
    }
    if (d.get != null) {
      d.get = wrapApi(d.get, `get ${className}.${key}`, opts)
    }
    if (d.set != null) {
      d.set = wrapApi(d.set, `set ${className}.${key}`, opts)
    }

    Object.defineProperty(out, key, d)
  })

  return out
}
