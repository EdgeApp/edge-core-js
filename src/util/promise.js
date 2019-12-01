// @flow

/**
 * Waits for the first successful promise.
 * If no promise succeeds, returns the last failure.
 */
export function anyPromise<T>(promises: Promise<T>[]): Promise<T> {
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
export function timeout<T>(
  promise: Promise<T>,
  ms: number,
  error: Error = new Error(`Timeout of ${ms}ms exceeded`)
): Promise<T> {
  const timeout = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms)
    const onDone = () => clearTimeout(timer)
    promise.then(onDone, onDone)
  })
  return Promise.race([promise, timeout])
}

/**
 * Waits for a collection of promises.
 * Returns all the promises that manage to resolve within the timeout.
 * If no promises mange to resolve within the timeout, returns the
 * first promise that resolves.
 * If all promises reject, rejects an array of errors.
 */
export function fuzzyTimeout<Type>(
  promises: Promise<Type>[],
  timeoutMs: number
): Promise<Type[]> {
  return new Promise((resolve, reject) => {
    let done = false
    const results = []
    const failures = []

    // Set up the timer:
    let timer = setTimeout(() => {
      timer = null
      if (results.length > 0) {
        done = true
        resolve(results)
      }
    }, timeoutMs)

    function checkEnd() {
      const allDone = results.length + failures.length === promises.length
      if (allDone && timer != null) {
        clearTimeout(timer)
      }
      if (allDone || timer == null) {
        done = true
        if (results.length > 0) resolve(results)
        else reject(failures)
      }
    }
    checkEnd() // Handle empty lists

    // Attach to the promises:
    for (const promise of promises) {
      promise.then(
        result => {
          if (done) return
          results.push(result)
          checkEnd()
        },
        failure => {
          if (done) return
          failures.push(failure)
          checkEnd()
        }
      )
    }
  })
}
