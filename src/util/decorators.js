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
