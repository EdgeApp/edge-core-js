/**
 * Waits for the first successful promise.
 * If no promise succeeds, returns the last failure.
 */
export function any (promises) {
  return new Promise((resolve, reject) => {
    let pending = promises.length
    for (const promise of promises) {
      promise.then(
        value => resolve(value),
        error => --pending || reject(error)
      )
    }
  })
}

/**
 * If the promise doesn't resolve in the given time,
 * reject it with the provided error, or a generic error if none is provided.
 */
export function timeout (promise, ms, error) {
  error = error || new Error(`Timeout of ${ms}ms exceeded`)
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(error), ms)
      const onDone = () => clearTimeout(timer)
      promise.then(onDone, onDone)
    })
  ])
}
