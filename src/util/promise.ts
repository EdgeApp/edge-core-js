/**
 * Waits for the first successful promise.
 * If no promise succeeds, returns the last failure.
 */
export function anyPromise<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise((resolve, reject) => {
    let failed = 0
    for (const promise of promises) {
      promise.then(resolve, error => {
        if (++failed >= promises.length) reject(error)
      })
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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms)
    promise.then(
      ok => {
        resolve(ok)
        clearTimeout(timer)
      },
      error => {
        reject(error)
        clearTimeout(timer)
      }
    )
  })
}

/**
 * Waits for a collection of promises.
 * Returns all the promises that manage to resolve within the timeout.
 * If no promises mange to resolve within the timeout,
 * returns the first promise that resolves.
 * If all promises reject, rejects an array of errors.
 */
export function fuzzyTimeout<T>(
  promises: Array<Promise<T>>,
  timeoutMs: number
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    let done = false
    const results: T[] = []
    const failures: any[] = []

    // Set up the timer:
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timer = undefined
      if (results.length > 0) {
        done = true
        resolve(results)
      }
    }, timeoutMs)

    function checkEnd(): void {
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
