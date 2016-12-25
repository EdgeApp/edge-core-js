/**
 * Converts a promise-returning function into a Node-style function,
 * but only an extra callback argument is actually passed in.
 */
export function nodeify (f) {
  return function () {
    const promise = f.apply(this, arguments)

    // Figure out what to do with the promise:
    const callback = arguments[arguments.length - 1]
    if (f.length < arguments.length && typeof callback === 'function') {
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
  return function () {
    try {
      return f.apply(this, arguments)
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
  return function () {
    nextTask = nextTask.then(
      win => f.apply(this, arguments),
      fail => f.apply(this, arguments)
    )
    return nextTask
  }
}
