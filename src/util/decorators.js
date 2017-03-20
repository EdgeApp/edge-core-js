/**
 * Prepares an async API endpoint for consumption by the outside world.
 */
export function asyncApi (f) {
  return nodeify(logify(rejectify(f)))
}

/**
 * Prepares a sync API endploint for consumption by the outside world.
 */
export function syncApi (f) {
  return function syncApi (...rest) {
    try {
      return f.apply(this, rest)
    } catch (e) {
      this.io.log.error(e)
      throw e
    }
  }
}

/**
 * If the function rejects with an error, note it in the logs.
 */
export function logify (f) {
  return function logify (...rest) {
    return f.apply(this, rest).catch(e => {
      this.io.log.error(e)
      throw e
    })
  }
}

/**
 * Converts a promise-returning function into a Node-style function,
 * but only an extra callback argument is actually passed in.
 */
export function nodeify (f) {
  return function nodeify (...rest) {
    const promise = f.apply(this, rest)

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
 * If the function f throws an error, return that as a rejected promise.
 */
export function rejectify (f) {
  return function rejectify (...rest) {
    try {
      return f.apply(this, rest)
    } catch (e) {
      return Promise.reject(e)
    }
  }
}

/**
 * Prevents a function from running in parallel.
 * The currently-running operation must finish before the new one starts.
 */
export function serialize (f) {
  let nextTask = Promise.resolve()
  return function serialize (...rest) {
    nextTask = nextTask.then(
      win => f.apply(this, rest),
      fail => f.apply(this, rest)
    )
    return nextTask
  }
}
